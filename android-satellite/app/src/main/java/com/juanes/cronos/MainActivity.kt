package com.juanes.cronos

import android.Manifest
import android.annotation.SuppressLint
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.content.pm.PackageManager
import android.net.http.SslError
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.util.Log
import android.view.View
import android.view.WindowManager
import android.webkit.*
import android.widget.EditText
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var nativeBridge: CronosNativeBridge
    private var voiceService: CronosVoiceService? = null
    private var isServiceBound = false
    private var speechRecognizer: SpeechRecognizer? = null
    private var speechIntent: Intent? = null

    private val mainHandler = Handler(Looper.getMainLooper())
    private var isListeningLoopActive = true
    private var isPausedForSpeaking = false

    private val serviceConnection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, service: IBinder?) {
            val binder = service as CronosVoiceService.LocalBinder
            voiceService = binder.getService()
            isServiceBound = true
        }

        override fun onServiceDisconnected(name: ComponentName?) {
            voiceService = null
            isServiceBound = false
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Pantalla completa inmersiva y mantener encendida (modo terminal 24/7)
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            or View.SYSTEM_UI_FLAG_FULLSCREEN
            or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
        )
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        webView = WebView(this)
        setContentView(webView)

        setupWebView()
        checkAndRequestPermissions()

        // Permitir cambiar la IP dejando pulsada la pantalla 2 segundos
        webView.setOnLongClickListener {
            showIpConfigDialog()
            true
        }
    }

    private fun checkAndRequestPermissions() {
        val hasAudio = ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        if (!hasAudio) {
            AlertDialog.Builder(this)
                .setTitle("🎙️ Activar Micrófono de Cronos")
                .setMessage("Para que Cronos funcione como asistente de voz continuo 24/7, Android requiere conceder el permiso de micrófono.\n\nEn el aviso que aparecerá a continuación, selecciona 'Mientras la app está en uso' o 'Permitir'.")
                .setPositiveButton("Conceder Permiso") { _, _ ->
                    requestAppPermissions()
                }
                .setCancelable(false)
                .show()
        } else {
            initNativeSpeechRecognizer()
            startVoiceCapture()
            startAndBindVoiceService()
        }
    }

    fun getServerIp(): String {
        val prefs = getSharedPreferences("cronos_prefs", Context.MODE_PRIVATE)
        return prefs.getString("server_ip", "192.168.1.161") ?: "192.168.1.161"
    }

    private fun setServerIp(ip: String) {
        val cleanIp = ip.trim()
        val prefs = getSharedPreferences("cronos_prefs", Context.MODE_PRIVATE)
        prefs.edit().putString("server_ip", cleanIp).apply()
        voiceService?.updateServerIp(cleanIp)
        webView.loadUrl("https://$cleanIp:8443")
        Toast.makeText(this, "Conectando a https://$cleanIp:8443", Toast.LENGTH_SHORT).show()
    }

    private fun showIpConfigDialog() {
        val currentIp = getServerIp()
        val input = EditText(this).apply {
            setText(currentIp)
            hint = "Ej: 192.168.1.161"
            setSelection(text.length)
        }

        AlertDialog.Builder(this)
            .setTitle("IP del Servidor Atlas")
            .setMessage("Introduce la IP actual del ordenador en tu red local:")
            .setView(input)
            .setPositiveButton("Guardar y Conectar") { _, _ ->
                val newIp = input.text.toString().trim()
                if (newIp.isNotEmpty()) {
                    setServerIp(newIp)
                }
            }
            .setNegativeButton("Cancelar", null)
            .show()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        nativeBridge = CronosNativeBridge(this, webView)

        // Aceleración por hardware para renderizar gráficos y animaciones a 60 FPS
        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null)

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = true
            allowContentAccess = true
            cacheMode = WebSettings.LOAD_DEFAULT
            @Suppress("DEPRECATION")
            setRenderPriority(WebSettings.RenderPriority.HIGH)
            useWideViewPort = true
            loadWithOverviewMode = true
        }

        webView.addJavascriptInterface(nativeBridge, "CronosNative")

        webView.webViewClient = object : WebViewClient() {
            @SuppressLint("WebViewClientOnReceivedSslError")
            override fun onReceivedSslError(
                view: WebView?,
                handler: SslErrorHandler?,
                error: SslError?
            ) {
                // Aceptar certificado autofirmado en la red local
                handler?.proceed()
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?
            ) {
                super.onReceivedError(view, request, error)
                if (request?.isForMainFrame == true) {
                    runOnUiThread {
                        showIpConfigDialog()
                    }
                }
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest?) {
                request?.grant(request.resources)
            }
        }

        val ip = getServerIp()
        webView.loadUrl("https://$ip:8443")
    }

    private fun initNativeSpeechRecognizer() {
        runOnUiThread {
            if (!SpeechRecognizer.isRecognitionAvailable(this)) {
                Log.e("CronosSpeech", "SpeechRecognizer no está disponible en este dispositivo")
                Toast.makeText(this, "Aviso: Motor de voz de Google no disponible", Toast.LENGTH_LONG).show()
                return@runOnUiThread
            }

            try {
                speechRecognizer?.cancel()
                speechRecognizer?.destroy()
            } catch (e: Exception) {}

            speechIntent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, "es-ES")
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, "es-ES")
                putExtra(RecognizerIntent.EXTRA_ONLY_RETURN_LANGUAGE_PREFERENCE, "es-ES")
                putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
            }

            try {
                speechRecognizer = SpeechRecognizer.createSpeechRecognizer(this).apply {
                    setRecognitionListener(object : RecognitionListener {
                        override fun onReadyForSpeech(params: Bundle?) {
                            Log.d("CronosSpeech", "Listo para escuchar")
                        }

                        override fun onBeginningOfSpeech() {
                            Log.d("CronosSpeech", "Voz detectada")
                        }

                        override fun onRmsChanged(rmsdB: Float) {}

                        override fun onBufferReceived(buffer: ByteArray?) {}

                        override fun onEndOfSpeech() {
                            Log.d("CronosSpeech", "Fin de frase")
                        }

                        override fun onError(error: Int) {
                            Log.d("CronosSpeech", "SpeechRecognizer error: $error")
                            // Si el motor se satura o se desconecta el cliente, recrear el reconocedor
                            if (error == SpeechRecognizer.ERROR_CLIENT || error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY) {
                                mainHandler.postDelayed({
                                    initNativeSpeechRecognizer()
                                    startVoiceCapture()
                                }, 250)
                                return
                            }
                            // Bucle reactivo rápido continuo (modo terminal 24/7 siempre enchufado)
                            scheduleNextListening(150)
                        }

                        override fun onResults(results: Bundle?) {
                            val matches = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                            val text = matches?.firstOrNull() ?: ""
                            if (text.isNotEmpty()) {
                                Log.i("CronosSpeech", "Frase transcrita: $text")
                                nativeBridge.notifyTranscript(text, true)
                            }
                            scheduleNextListening(150)
                        }

                        override fun onPartialResults(partialResults: Bundle?) {
                            val matches = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                            val text = matches?.firstOrNull() ?: ""
                            if (text.isNotEmpty()) {
                                nativeBridge.notifyTranscript(text, false)
                            }
                        }

                        override fun onEvent(eventType: Int, params: Bundle?) {}
                    })
                }
            } catch (e: Exception) {
                Log.e("CronosSpeech", "Error creando SpeechRecognizer", e)
            }
        }
    }

    private fun scheduleNextListening(delayMs: Long) {
        if (!isListeningLoopActive || isPausedForSpeaking) return
        mainHandler.removeCallbacksAndMessages(null)
        mainHandler.postDelayed({
            startVoiceCapture()
        }, delayMs)
    }

    fun startVoiceCapture() {
        runOnUiThread {
            if (!isListeningLoopActive || isPausedForSpeaking) return@runOnUiThread

            if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                checkAndRequestPermissions()
                return@runOnUiThread
            }

            if (speechRecognizer == null) {
                initNativeSpeechRecognizer()
            }

            try {
                // Cancelar cualquier captura previa bloqueada antes de reenganchar
                speechRecognizer?.cancel()
                speechRecognizer?.startListening(speechIntent)
            } catch (e: Exception) {
                Log.w("CronosSpeech", "Error al iniciar escucha: ${e.message}")
                scheduleNextListening(300)
            }
        }
    }

    fun stopVoiceCapture() {
        runOnUiThread {
            isListeningLoopActive = false
            mainHandler.removeCallbacksAndMessages(null)
            try {
                speechRecognizer?.stopListening()
            } catch (e: Exception) {}
        }
    }

    fun pauseContinuousListening() {
        runOnUiThread {
            isPausedForSpeaking = true
            mainHandler.removeCallbacksAndMessages(null)
            try {
                speechRecognizer?.stopListening()
                speechRecognizer?.cancel()
            } catch (e: Exception) {}
        }
    }

    fun resumeContinuousListening() {
        runOnUiThread {
            isPausedForSpeaking = false
            scheduleNextListening(200)
        }
    }

    private fun requestAppPermissions() {
        val permissions = mutableListOf(Manifest.permission.RECORD_AUDIO)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            permissions.add(Manifest.permission.POST_NOTIFICATIONS)
        }

        val needed = permissions.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }

        if (needed.isNotEmpty()) {
            ActivityCompat.requestPermissions(this, needed.toTypedArray(), 101)
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == 101) {
            val audioGranted = ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
            if (audioGranted) {
                Toast.makeText(this, "🎙️ Micrófono activado para Cronos", Toast.LENGTH_SHORT).show()
                initNativeSpeechRecognizer()
                startVoiceCapture()
                startAndBindVoiceService()
            } else {
                showPermissionDeniedDialog()
            }
        }
    }

    private fun showPermissionDeniedDialog() {
        AlertDialog.Builder(this)
            .setTitle("⚠️ Permiso de Micrófono Requerido")
            .setMessage("Cronos no puede escuchar tus órdenes por voz porque el permiso de micrófono está desactivado.\n\nPor favor, ve a Ajustes y activa el permiso de 'Micrófono' para Cronos.")
            .setPositiveButton("Abrir Ajustes") { _, _ ->
                val intent = Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                    data = android.net.Uri.fromParts("package", packageName, null)
                }
                startActivity(intent)
            }
            .setNegativeButton("Cancelar", null)
            .show()
    }

    private fun startAndBindVoiceService() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            Log.w("CronosSpeech", "startAndBindVoiceService pospuesto hasta tener RECORD_AUDIO")
            return
        }

        val intent = Intent(this, CronosVoiceService::class.java)
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(intent)
            } else {
                startService(intent)
            }
            bindService(intent, serviceConnection, Context.BIND_AUTO_CREATE)
        } catch (e: Exception) {
            Log.e("CronosSpeech", "Error arrancando CronosVoiceService: ${e.message}")
        }
    }

    override fun onPause() {
        super.onPause()
        // Modo terminal 24/7 enchufado: NO pausamos la escucha de voz
    }

    override fun onResume() {
        super.onResume()
        isListeningLoopActive = true
        scheduleNextListening(200)
    }

    override fun onDestroy() {
        isListeningLoopActive = false
        mainHandler.removeCallbacksAndMessages(null)
        speechRecognizer?.destroy()
        if (isServiceBound) {
            unbindService(serviceConnection)
            isServiceBound = false
        }
        super.onDestroy()
    }
}
