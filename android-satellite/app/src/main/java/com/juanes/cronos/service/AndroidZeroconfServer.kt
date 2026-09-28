package com.juanes.cronos.service

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.util.Log
import com.spotify.connectstate.Connect
import org.json.JSONObject
import xyz.gianlu.librespot.common.Utils
import xyz.gianlu.librespot.core.Session
import xyz.gianlu.librespot.crypto.DiffieHellman
import java.io.*
import java.net.ServerSocket
import java.net.Socket
import java.net.URLDecoder
import java.security.GeneralSecurityException
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.*
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Servidor Zeroconf y HTTP nativo para Android.
 * Reemplaza la implementación Zeroconf de escritorio de Librespot que es
 * incompatible con Android 10+ (falla al consultar MAC address y getLocalHost).
 *
 * Utiliza android.net.nsd.NsdManager para anunciarse como "_spotify-connect._tcp"
 * y un ServerSocket ultraligero para responder a getInfo y addUser.
 */
class AndroidZeroconfServer(
    private val context: Context,
    private val sessionConfig: Session.Configuration,
    private var deviceName: String,
    private val onSessionCreated: (Session) -> Unit
) : Closeable {

    companion object {
        private const val TAG = "CronosZeroconf"
        private const val SERVICE_TYPE = "_spotify-connect._tcp"
    }

    private val nsdManager = context.getSystemService(Context.NSD_SERVICE) as NsdManager
    private val keys = DiffieHellman(SecureRandom())
    private val deviceId: String = getOrCreateDeviceId(context)

    private var serverSocket: ServerSocket? = null
    private var serverPort: Int = 0
    private var isRunning: Boolean = false
    private var isNsdRegistered: Boolean = false
    private var executor: ExecutorService? = null
    private var serverThread: Thread? = null

    @Volatile
    var currentSession: Session? = null

    private val registrationListener = object : NsdManager.RegistrationListener {
        override fun onServiceRegistered(serviceInfo: NsdServiceInfo) {
            Log.i(TAG, "🟢 Spotify Connect mDNS anunciado como '${serviceInfo.serviceName}' en puerto $serverPort")
            isNsdRegistered = true
        }

        override fun onRegistrationFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {
            Log.e(TAG, "❌ Error registrando mDNS: código $errorCode")
            isNsdRegistered = false
        }

        override fun onServiceUnregistered(serviceInfo: NsdServiceInfo) {
            Log.i(TAG, "⏹️ Spotify Connect mDNS detenido")
            isNsdRegistered = false
        }

        override fun onUnregistrationFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {
            Log.w(TAG, "Aviso desregistrando mDNS: código $errorCode")
        }
    }

    init {
        start()
    }

    private fun getOrCreateDeviceId(context: Context): String {
        val prefs = context.getSharedPreferences("cronos_spotify_conf", Context.MODE_PRIVATE)
        var id = prefs.getString("device_id", null)
        if (id.isNullOrBlank()) {
            val random = SecureRandom()
            val bytes = ByteArray(20)
            random.nextBytes(bytes)
            id = bytes.joinToString("") { "%02x".format(it) }
            prefs.edit().putString("device_id", id).apply()
        }
        return id
    }

    @Synchronized
    private fun start() {
        try {
            // Intentar puerto 5005 o cualquier puerto dinámico libre
            serverSocket = try {
                ServerSocket(5005)
            } catch (e: Exception) {
                ServerSocket(0)
            }
            serverPort = serverSocket!!.localPort
            isRunning = true

            executor = Executors.newCachedThreadPool()
            serverThread = Thread({
                runHttpServer()
            }, "cronos-spotify-http").apply {
                isDaemon = true
                start()
            }

            registerMdns()
            Log.i(TAG, "✅ Servidor HTTP Spotify Zeroconf listo en puerto $serverPort (DeviceID=$deviceId)")
        } catch (e: Exception) {
            Log.e(TAG, "Error iniciando AndroidZeroconfServer", e)
        }
    }

    private fun registerMdns() {
        try {
            val serviceInfo = NsdServiceInfo().apply {
                serviceName = deviceName
                serviceType = SERVICE_TYPE
                port = serverPort
                setAttribute("CPath", "/")
                setAttribute("VERSION", "1.0")
                setAttribute("Stack", "SP")
            }
            nsdManager.registerService(serviceInfo, NsdManager.PROTOCOL_DNS_SD, registrationListener)
        } catch (e: Exception) {
            Log.e(TAG, "Error al invocar registerService en NsdManager", e)
        }
    }

    private fun unregisterMdns() {
        if (isNsdRegistered) {
            try {
                nsdManager.unregisterService(registrationListener)
            } catch (e: Exception) {
                Log.w(TAG, "Error desregistrando NsdManager: ${e.message}")
            }
            isNsdRegistered = false
        }
    }

    fun updateDeviceName(newName: String) {
        val cleanName = newName.trim()
        if (cleanName.isBlank() || cleanName == deviceName) return
        Log.i(TAG, "Actualizando nombre Zeroconf a '$cleanName'")
        deviceName = cleanName
        unregisterMdns()
        registerMdns()
    }

    private fun runHttpServer() {
        while (isRunning && serverSocket?.isClosed == false) {
            try {
                val client = serverSocket?.accept() ?: break
                executor?.execute { handleClient(client) }
            } catch (e: Exception) {
                if (isRunning) {
                    Log.w(TAG, "Error en accept de socket HTTP: ${e.message}")
                }
            }
        }
    }

    private fun handleClient(socket: Socket) {
        try {
            socket.use { s ->
                s.soTimeout = 8000
                val input = s.getInputStream()
                val reader = BufferedReader(InputStreamReader(input, Charsets.UTF_8))
                val output = s.getOutputStream()

                val requestLine = reader.readLine() ?: return
                val parts = requestLine.split(" ")
                if (parts.size < 2) return

                val method = parts[0].uppercase()
                val url = parts[1]

                val headers = mutableMapOf<String, String>()
                var headerLine: String?
                while (reader.readLine().also { headerLine = it } != null) {
                    if (headerLine.isNullOrBlank()) break
                    val headerParts = headerLine!!.split(":", limit = 2)
                    if (headerParts.size == 2) {
                        headers[headerParts[0].trim().lowercase()] = headerParts[1].trim()
                    }
                }

                val queryMap = mutableMapOf<String, String>()
                val queryIndex = url.indexOf('?')
                if (queryIndex != -1 && queryIndex < url.length - 1) {
                    val queryString = url.substring(queryIndex + 1)
                    parseQueryParams(queryString, queryMap)
                }

                if (method == "POST") {
                    val contentLength = headers["content-length"]?.toIntOrNull() ?: 0
                    if (contentLength > 0 && contentLength < 65536) {
                        val bodyChars = CharArray(contentLength)
                        var totalRead = 0
                        while (totalRead < contentLength) {
                            val r = reader.read(bodyChars, totalRead, contentLength - totalRead)
                            if (r == -1) break
                            totalRead += r
                        }
                        val body = String(bodyChars, 0, totalRead)
                        parseQueryParams(body, queryMap)
                    }
                }

                val action = queryMap["action"] ?: ""
                when (action) {
                    "getInfo" -> handleGetInfo(output)
                    "addUser" -> handleAddUser(output, queryMap)
                    else -> {
                        Log.d(TAG, "Acción desconocida o no soportada: $action")
                        sendHttpResponse(output, 404, "Not Found", "text/plain", "Action not supported".toByteArray())
                    }
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Error procesando petición HTTP de Spotify: ${e.message}")
        }
    }

    private fun parseQueryParams(data: String, map: MutableMap<String, String>) {
        val pairs = data.split('&')
        for (pair in pairs) {
            val kv = pair.split('=', limit = 2)
            if (kv.isNotEmpty()) {
                val k = URLDecoder.decode(kv[0], "UTF-8")
                val v = if (kv.size > 1) URLDecoder.decode(kv[1], "UTF-8") else ""
                map[k] = v
            }
        }
    }

    private fun handleGetInfo(output: OutputStream) {
        val activeUser = currentSession?.username() ?: ""
        val pubKeyBase64 = Utils.toBase64(keys.publicKeyArray())

        val json = JSONObject().apply {
            put("status", 101)
            put("statusString", "OK")
            put("spotifyError", 0)
            put("version", "2.7.1")
            put("deviceID", deviceId)
            put("remoteName", deviceName)
            put("activeUser", activeUser)
            put("publicKey", pubKeyBase64)
            put("deviceType", "SPEAKER")
            put("libraryVersion", "1.6.5")
            put("accountReq", "PREMIUM")
            put("brandDisplayName", "Cronos")
            put("modelDisplayName", "Satellite")
            put("voiceSupport", "NO")
            put("availability", "")
            put("productID", 0)
            put("tokenType", "default")
            put("groupStatus", "NONE")
            put("resolverVersion", "0")
            put("scope", "streaming,client-authorization-universal")
        }.toString()

        Log.i(TAG, "📱 Enviando getInfo a Spotify: device='$deviceName', activeUser='$activeUser'")
        sendHttpResponse(output, 200, "OK", "application/json", json.toByteArray(Charsets.UTF_8))
    }

    private fun handleAddUser(output: OutputStream, params: Map<String, String>) {
        val userName = params["userName"] ?: ""
        val blob = params["blob"] ?: ""
        val clientKey = params["clientKey"] ?: ""

        if (userName.isBlank() || blob.isBlank() || clientKey.isBlank()) {
            Log.e(TAG, "Parámetros incompletos en addUser (userName, blob o clientKey faltante)")
            sendHttpResponse(output, 400, "Bad Request", "text/plain", "Missing parameters".toByteArray())
            return
        }

        Log.i(TAG, "🔑 Recibida petición addUser para usuario: $userName")

        val decryptedBlob = try {
            decryptBlob(clientKey, blob)
        } catch (e: Exception) {
            Log.e(TAG, "Error desencriptando blob de Spotify: ${e.message}", e)
            sendHttpResponse(output, 400, "Bad Request", "text/plain", "Decryption failed".toByteArray())
            return
        }

        // 1. Responder inmediatamente 200 OK a la app oficial de Spotify
        val successJson = JSONObject().apply {
            put("status", 101)
            put("spotifyError", 0)
            put("statusString", "OK")
        }.toString()

        sendHttpResponse(output, 200, "OK", "application/json", successJson.toByteArray(Charsets.UTF_8))
        Log.i(TAG, "✅ Respuesta 200 OK enviada a Spotify. Creando sesión para $userName...")

        // 2. Crear sesión en Librespot en hilo de trabajo
        executor?.execute {
            try {
                try {
                    currentSession?.close()
                } catch (e: Exception) {}

                val newSession = Session.Builder(sessionConfig)
                    .setDeviceId(deviceId)
                    .setDeviceName(deviceName)
                    .setDeviceType(Connect.DeviceType.SPEAKER)
                    .setPreferredLocale(Locale.getDefault().language)
                    .blob(userName, decryptedBlob)
                    .create()

                currentSession = newSession
                Log.i(TAG, "🎉 ¡Sesión de Spotify Connect creada exitosamente para $userName!")
                onSessionCreated(newSession)
            } catch (e: Exception) {
                Log.e(TAG, "Error creando sesión Librespot tras addUser", e)
            }
        }
    }

    private fun decryptBlob(clientKey: String, blob: String): ByteArray {
        val clientKeyBytes = Utils.fromBase64(clientKey)
        val blobBytes = Utils.fromBase64(blob)

        val sharedKey = keys.computeSharedKey(clientKeyBytes)
        val sharedKeyBytes = Utils.toByteArray(sharedKey)

        val iv = blobBytes.copyOfRange(0, 16)
        val encrypted = blobBytes.copyOfRange(16, blobBytes.size - 20)
        val expectedMac = blobBytes.copyOfRange(blobBytes.size - 20, blobBytes.size)

        val md = MessageDigest.getInstance("SHA-1")
        val baseKey = md.digest(sharedKeyBytes).copyOfRange(0, 16)

        val mac = Mac.getInstance("HmacSHA1")
        mac.init(SecretKeySpec(baseKey, "HmacSHA1"))
        val macChecksumKey = mac.doFinal("checksum".toByteArray(Charsets.UTF_8))
        val macEncryptionKey = mac.doFinal("encryption".toByteArray(Charsets.UTF_8))

        mac.init(SecretKeySpec(macChecksumKey, "HmacSHA1"))
        val calculatedMac = mac.doFinal(encrypted)

        if (!calculatedMac.contentEquals(expectedMac)) {
            throw GeneralSecurityException("MAC and checksum do not match")
        }

        val cipher = Cipher.getInstance("AES/CTR/NoPadding")
        cipher.init(
            Cipher.DECRYPT_MODE,
            SecretKeySpec(macEncryptionKey.copyOfRange(0, 16), "AES"),
            IvParameterSpec(iv)
        )
        return cipher.doFinal(encrypted)
    }

    private fun sendHttpResponse(
        output: OutputStream,
        statusCode: Int,
        statusText: String,
        contentType: String,
        body: ByteArray
    ) {
        val header = "HTTP/1.1 $statusCode $statusText\r\n" +
                "Content-Type: $contentType\r\n" +
                "Content-Length: ${body.size}\r\n" +
                "Connection: close\r\n\r\n"
        output.write(header.toByteArray(Charsets.UTF_8))
        output.write(body)
        output.flush()
    }

    override fun close() {
        isRunning = false
        unregisterMdns()
        try {
            serverSocket?.close()
        } catch (e: Exception) {}
        executor?.shutdown()
        try {
            currentSession?.close()
        } catch (e: Exception) {}
    }
}
