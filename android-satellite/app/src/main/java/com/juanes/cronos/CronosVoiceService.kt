package com.juanes.cronos

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Binder
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.*
import okhttp3.*
import okio.ByteString.Companion.toByteString

class CronosVoiceService : Service() {

    private val binder = LocalBinder()
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var isRecording = false
    private var audioRecord: AudioRecord? = null
    private var webSocket: WebSocket? = null
    private val okHttpClient = OkHttpClient()

    private val sampleRate = 16000
    private val channelConfig = AudioFormat.CHANNEL_IN_MONO
    private val audioFormat = AudioFormat.ENCODING_PCM_16BIT

    var onStateChanged: ((String) -> Unit)? = null
    var onTranscriptReceived: ((String, Boolean) -> Unit)? = null

    inner class LocalBinder : Binder() {
        fun getService(): CronosVoiceService = this@CronosVoiceService
    }

    override fun onBind(intent: Intent?): IBinder = binder

    override fun onCreate() {
        super.onCreate()
        startForegroundServiceNotification()
        connectWebSocket()
    }

    private fun getServerIp(): String {
        val prefs = getSharedPreferences("cronos_prefs", Context.MODE_PRIVATE)
        return prefs.getString("server_ip", "192.168.1.161") ?: "192.168.1.161"
    }

    fun updateServerIp(newIp: String) {
        val prefs = getSharedPreferences("cronos_prefs", Context.MODE_PRIVATE)
        prefs.edit().putString("server_ip", newIp).apply()
        webSocket?.close(1000, "IP cambiada")
        webSocket = null
        connectWebSocket()
    }

    private fun startForegroundServiceNotification() {
        val channelId = "cronos_satellite_channel"
        val channelName = "Cronos - Servicio de Micrófono"

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                channelId,
                channelName,
                NotificationManager.IMPORTANCE_DEFAULT
            ).apply {
                description = "Notificación obligatoria de Android para indicar que Cronos está usando el micrófono de forma continua"
                setShowBadge(true)
            }
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.createNotificationChannel(channel)
        }

        val notification: Notification = NotificationCompat.Builder(this, channelId)
            .setContentTitle("🎙️ Cronos - Micrófono Activo")
            .setContentText("Escuchando órdenes de voz 24/7 en segundo plano")
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setOngoing(true)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .build()

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(
                    1001,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
                )
            } else {
                startForeground(1001, notification)
            }
        } catch (e: Exception) {
            Log.e("CronosVoiceService", "startForeground con tipo micrófono falló o permiso pendiente: ${e.message}")
            try {
                startForeground(1001, notification)
            } catch (ex: Exception) {
                Log.e("CronosVoiceService", "Fallback startForeground falló", ex)
            }
        }
    }

    private fun connectWebSocket() {
        val ip = getServerIp()
        val request = Request.Builder()
            .url("ws://$ip:8080")
            .build()

        webSocket = okHttpClient.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                Log.i("CronosVoiceService", "Conectado al servidor Atlas ($ip:8080) por WebSocket")
                val registerPayload = """{"event":"REGISTER_SATELLITE","device_name":"Android App"}"""
                webSocket.send(registerPayload)
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                Log.d("CronosVoiceService", "WS Mensaje recibido: $text")
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Log.w("CronosVoiceService", "Error WS satélite ($ip:8080): ${t.message}. Reintentando en 5s...")
                scope.launch {
                    delay(5000)
                    connectWebSocket()
                }
            }
        })
    }

    fun startListening() {
        if (isRecording) return
        val bufferSize = AudioRecord.getMinBufferSize(sampleRate, channelConfig, audioFormat)
        if (bufferSize == AudioRecord.ERROR || bufferSize == AudioRecord.ERROR_BAD_VALUE) {
            Log.e("CronosVoiceService", "Error calculando bufferSize para AudioRecord")
            return
        }

        try {
            audioRecord = AudioRecord(
                MediaRecorder.AudioSource.VOICE_RECOGNITION,
                sampleRate,
                channelConfig,
                audioFormat,
                bufferSize * 2
            )

            if (audioRecord?.state != AudioRecord.STATE_INITIALIZED) {
                Log.e("CronosVoiceService", "AudioRecord no se pudo inicializar")
                return
            }

            audioRecord?.startRecording()
            isRecording = true
            onStateChanged?.invoke("LISTENING")

            scope.launch {
                val buffer = ByteArray(bufferSize)
                while (isRecording) {
                    val read = audioRecord?.read(buffer, 0, buffer.size) ?: -1
                    if (read > 0) {
                        webSocket?.send(buffer.copyOf(read).toByteString())
                    }
                }
            }
        } catch (e: SecurityException) {
            Log.e("CronosVoiceService", "Permiso de audio no concedido", e)
        }
    }

    fun stopListening() {
        if (!isRecording) return
        isRecording = false
        try {
            audioRecord?.stop()
            audioRecord?.release()
        } catch (e: Exception) {
            Log.w("CronosVoiceService", "Error al detener AudioRecord", e)
        }
        audioRecord = null
        onStateChanged?.invoke("IDLE")
    }

    override fun onDestroy() {
        stopListening()
        webSocket?.close(1000, "Servicio detenido")
        scope.cancel()
        super.onDestroy()
    }
}
