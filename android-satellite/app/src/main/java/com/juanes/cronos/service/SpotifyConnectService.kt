package com.juanes.cronos.service

import android.app.*
import android.content.Context
import android.content.Intent
import android.net.wifi.WifiManager
import android.os.Binder
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat
import com.spotify.connectstate.Connect
import kotlinx.coroutines.*
import xyz.gianlu.librespot.audio.MetadataWrapper
import xyz.gianlu.librespot.audio.decoders.AudioQuality
import xyz.gianlu.librespot.core.Session
import xyz.gianlu.librespot.metadata.PlayableId
import xyz.gianlu.librespot.player.Player
import xyz.gianlu.librespot.player.PlayerConfiguration
import java.io.File

/**
 * Servicio en primer plano que ejecuta el receptor nativo de Spotify Connect
 * utilizando Librespot y AndroidZeroconfServer (NsdManager + HTTP).
 * Permite que este dispositivo Android (ej: Samsung Galaxy A20e) aparezca
 * en la red como un altavoz Spotify Connect ("Cronos Dormitorio") y reciba
 * streaming de audio directo vía AudioTrack sin depender de apps oficiales ni WebView.
 */
class SpotifyConnectService : Service() {

    companion object {
        private const val TAG = "CronosSpotifyService"
        private const val CHANNEL_ID = "cronos_spotify_connect"
        private const val NOTIFICATION_ID = 2002

        const val ACTION_START = "com.juanes.cronos.spotify.START"
        const val ACTION_STOP = "com.juanes.cronos.spotify.STOP"
        const val EXTRA_DEVICE_NAME = "device_name"
    }

    private val binder = LocalBinder()
    private val serviceScope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    private var multicastLock: WifiManager.MulticastLock? = null
    private var wifiLock: WifiManager.WifiLock? = null
    private var wakeLock: PowerManager.WakeLock? = null

    private var zeroconfServer: AndroidZeroconfServer? = null
    private var currentSession: Session? = null
    private var player: Player? = null

    private var currentDeviceName: String = "Cronos Satellite"
    private var currentTrackName: String = ""

    inner class LocalBinder : Binder() {
        fun getService(): SpotifyConnectService = this@SpotifyConnectService
    }

    override fun onBind(intent: Intent?): IBinder = binder

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        acquireLocks()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action ?: ACTION_START
        if (action == ACTION_STOP) {
            stopSelf()
            return START_NOT_STICKY
        }

        val name = intent?.getStringExtra(EXTRA_DEVICE_NAME)
        if (!name.isNullOrBlank()) {
            currentDeviceName = name
        }

        startForeground(NOTIFICATION_ID, buildNotification("Iniciando receptor Spotify Connect..."))

        serviceScope.launch {
            startSpotifyReceiver(currentDeviceName)
        }

        return START_STICKY
    }

    fun updateDeviceName(newName: String) {
        val cleanName = newName.trim()
        if (cleanName.isBlank() || cleanName == currentDeviceName) return

        Log.i(TAG, "Cambiando nombre de dispositivo de '$currentDeviceName' a '$cleanName'")
        currentDeviceName = cleanName
        zeroconfServer?.updateDeviceName(cleanName)
        updateNotificationState("Listo para recibir música en $cleanName")
    }

    private fun acquireLocks() {
        try {
            val wifiManager = applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
            if (wifiManager != null) {
                multicastLock = wifiManager.createMulticastLock("cronos_spotify_multicast").apply {
                    setReferenceCounted(true)
                    acquire()
                }
                @Suppress("DEPRECATION")
                wifiLock = wifiManager.createWifiLock(
                    WifiManager.WIFI_MODE_FULL_HIGH_PERF,
                    "cronos_spotify_wifi"
                ).apply {
                    setReferenceCounted(false)
                    acquire()
                }
            }

            val powerManager = getSystemService(Context.POWER_SERVICE) as? PowerManager
            wakeLock = powerManager?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "cronos:spotify_wake")?.apply {
                setReferenceCounted(false)
                acquire()
            }
            Log.i(TAG, "Locks de red y energía adquiridos.")
        } catch (e: Exception) {
            Log.w(TAG, "Aviso adquiriendo locks: ${e.message}")
        }
    }

    private fun releaseLocks() {
        try {
            if (multicastLock?.isHeld == true) multicastLock?.release()
            if (wifiLock?.isHeld == true) wifiLock?.release()
            if (wakeLock?.isHeld == true) wakeLock?.release()
        } catch (e: Exception) {
            Log.w(TAG, "Error liberando locks: ${e.message}")
        }
    }

    private suspend fun startSpotifyReceiver(deviceName: String) = withContext(Dispatchers.IO) {
        try {
            val spotifyDir = File(cacheDir, "spotify")
            if (!spotifyDir.exists()) spotifyDir.mkdirs()

            val credFile = File(spotifyDir, "credentials.json")

            val sessionConfig = Session.Configuration.Builder()
                .setCacheEnabled(true)
                .setCacheDir(File(spotifyDir, "cache"))
                .setStoreCredentials(true)
                .setStoredCredentialsFile(credFile)
                .build()

            // 1. Intentar restaurar sesión previa si existen credenciales guardadas
            if (credFile.exists() && credFile.length() > 0) {
                try {
                    Log.i(TAG, "Restaurando sesión de Spotify Connect desde credenciales guardadas...")
                    val session = Session.Builder(sessionConfig)
                        .setDeviceName(deviceName)
                        .setDeviceType(Connect.DeviceType.SPEAKER)
                        .stored(credFile)
                        .create()

                    currentSession = session
                    initPlayer(session)
                    updateNotificationState("🟢 Conectado como altavoz: $deviceName")
                    Log.i(TAG, "✅ Sesión restaurada con éxito para usuario: ${session.username()}")
                } catch (e: Exception) {
                    Log.w(TAG, "No se pudo reutilizar credenciales guardadas: ${e.message}. Esperando Zeroconf...")
                }
            }

            // 2. Iniciar servidor Zeroconf (mDNS) para ser descubierto siempre en la red local
            startZeroconfServer(sessionConfig, deviceName)

        } catch (e: Exception) {
            Log.e(TAG, "Error general iniciando receptor Spotify", e)
            updateNotificationState("⚠️ Error al iniciar receptor Spotify: ${e.message}")
        }
    }

    private fun startZeroconfServer(sessionConfig: Session.Configuration, deviceName: String) {
        try {
            zeroconfServer?.close()
        } catch (e: Exception) {}

        try {
            Log.i(TAG, "Iniciando AndroidZeroconfServer como '$deviceName'...")
            val server = AndroidZeroconfServer(
                context = applicationContext,
                sessionConfig = sessionConfig,
                deviceName = deviceName,
                onSessionCreated = { newSession ->
                    Log.i(TAG, "🟢 Nueva sesión de Spotify Connect recibida: ${newSession.username()}")
                    currentSession = newSession
                    initPlayer(newSession)
                    updateNotificationState("🟢 Conectado con ${newSession.username()} en $currentDeviceName")
                }
            )

            if (currentSession != null) {
                server.currentSession = currentSession
            }

            zeroconfServer = server
            updateNotificationState("Listo para recibir música en $deviceName")
            Log.i(TAG, "✅ AndroidZeroconfServer anunciado exitosamente en la red local.")
        } catch (e: Exception) {
            Log.e(TAG, "Error creando AndroidZeroconfServer", e)
        }
    }

    private fun initPlayer(session: Session) {
        try {
            player?.close()
        } catch (e: Exception) {}

        try {
            val playerConfig = PlayerConfiguration.Builder()
                .setOutput(PlayerConfiguration.AudioOutput.CUSTOM)
                .setOutputClass("com.juanes.cronos.audio.AndroidAudioSink")
                .setPreferredQuality(AudioQuality.HIGH)
                .setAutoplayEnabled(true)
                .build()

            val newPlayer = Player(playerConfig, session)

            newPlayer.addEventsListener(object : Player.EventsListener {
                override fun onContextChanged(player: Player, context: String) {}

                override fun onTrackChanged(
                    player: Player,
                    id: PlayableId,
                    metadata: MetadataWrapper?,
                    userInitiated: Boolean
                ) {
                    val name = metadata?.name ?: "Música"
                    val artist = metadata?.artist
                    currentTrackName = if (artist.isNullOrBlank()) name else "$name - $artist"
                    Log.i(TAG, "🎵 Reproduciendo: $currentTrackName")
                    updateNotificationState("▶️ $currentTrackName")
                }

                override fun onPlaybackEnded(player: Player) {
                    Log.i(TAG, "⏹️ Fin de reproducción")
                    updateNotificationState("Listo para recibir música en $currentDeviceName")
                }

                override fun onPlaybackPaused(player: Player, trackTime: Long) {
                    Log.i(TAG, "⏸️ Pausado")
                    updateNotificationState("⏸️ En pausa: $currentTrackName")
                }

                override fun onPlaybackResumed(player: Player, trackTime: Long) {
                    Log.i(TAG, "▶️ Reanudado")
                    updateNotificationState("▶️ $currentTrackName")
                }

                override fun onPlaybackFailed(player: Player, e: Exception) {
                    Log.e(TAG, "⚠️ Error en reproducción", e)
                }

                override fun onTrackSeeked(player: Player, trackTime: Long) {}
                override fun onMetadataAvailable(player: Player, metadata: MetadataWrapper) {}
                override fun onPlaybackHaltStateChanged(player: Player, halted: Boolean, trackTime: Long) {}
                override fun onInactiveSession(player: Player, timeout: Boolean) {}
                override fun onVolumeChanged(player: Player, volume: Float) {}
                override fun onPanicState(player: Player) {}
                override fun onStartedLoading(player: Player) {}
                override fun onFinishedLoading(player: Player) {}
            })

            player = newPlayer
            Log.i(TAG, "✅ Librespot Player inicializado con AndroidAudioSink")
        } catch (e: Exception) {
            Log.e(TAG, "Error inicializando Librespot Player", e)
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Spotify Connect Receiver",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Receptor de música Spotify Connect para Cronos Satellite"
                setShowBadge(false)
            }
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(statusText: String): Notification {
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
        val pendingIntent = if (launchIntent != null) {
            PendingIntent.getActivity(
                this,
                0,
                launchIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
        } else null

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("🎵 Spotify Connect ($currentDeviceName)")
            .setContentText(statusText)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setOngoing(true)
            .setContentIntent(pendingIntent)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    private fun updateNotificationState(statusText: String) {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
        manager?.notify(NOTIFICATION_ID, buildNotification(statusText))
    }

    override fun onDestroy() {
        serviceScope.cancel()
        try {
            player?.close()
            player = null
            zeroconfServer?.close()
            zeroconfServer = null
            currentSession?.close()
            currentSession = null
        } catch (e: Exception) {
            Log.w(TAG, "Error cerrando recursos de Spotify: ${e.message}")
        }
        releaseLocks()
        super.onDestroy()
    }
}
