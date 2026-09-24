package com.juanes.cronos

import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView

class CronosNativeBridge(
    private val activity: MainActivity,
    private val webView: WebView
) {
    private val mainHandler = Handler(Looper.getMainLooper())

    @JavascriptInterface
    fun isNativeApp(): Boolean = true

    @JavascriptInterface
    fun getServerIp(): String = activity.getServerIp()

    @JavascriptInterface
    fun getWsUrl(): String = "ws://${activity.getServerIp()}:8080"

    @JavascriptInterface
    fun getHttpsUrl(): String = "https://${activity.getServerIp()}:8443"

    @JavascriptInterface
    fun startListening() {
        Log.d("CronosBridge", "startListening requested from JS")
        activity.startVoiceCapture()
    }

    @JavascriptInterface
    fun stopListening() {
        Log.d("CronosBridge", "stopListening requested from JS")
        activity.stopVoiceCapture()
    }

    @JavascriptInterface
    fun pauseListening() {
        Log.d("CronosBridge", "pauseListening requested (speaking)")
        activity.pauseContinuousListening()
    }

    @JavascriptInterface
    fun resumeListening() {
        Log.d("CronosBridge", "resumeListening requested (speaking done)")
        activity.resumeContinuousListening()
    }

    @JavascriptInterface
    fun log(message: String) {
        Log.i("CronosJS", message)
    }

    fun notifyStateChange(state: String) {
        val safeState = org.json.JSONObject.quote(state)
        runOnJs("if (window.onCronosNativeState) { window.onCronosNativeState($safeState); }")
    }

    fun notifyTranscript(text: String, isFinal: Boolean) {
        val safeText = org.json.JSONObject.quote(text)
        runOnJs("if (window.onCronosNativeTranscript) { window.onCronosNativeTranscript($safeText, $isFinal); }")
    }

    private fun runOnJs(script: String) {
        mainHandler.post {
            webView.evaluateJavascript(script, null)
        }
    }
}
