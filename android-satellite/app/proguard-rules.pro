# Keep Cronos native bridge and all models
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

-keep class com.juanes.cronos.** { *; }

# Keep OkHttp & Okio (WebSocket client)
-dontwarn okhttp3.**
-dontwarn okio.**
-keep class okhttp3.** { *; }
-keep interface okhttp3.** { *; }

# Keep Kotlin Coroutines
-keepnames class kotlinx.coroutines.** { *; }
-dontwarn kotlinx.coroutines.**
