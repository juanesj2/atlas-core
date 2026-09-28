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

# Keep Librespot & Audio Sink
-keep class xyz.gianlu.librespot.** { *; }
-dontwarn xyz.gianlu.librespot.**
-keep class com.spotify.** { *; }
-dontwarn com.spotify.**
-keep class xyz.gianlu.zeroconf.** { *; }
-dontwarn xyz.gianlu.zeroconf.**
-keep class org.jcraft.jorbis.** { *; }
-dontwarn org.jcraft.jorbis.**
-keep class javazoom.jl.** { *; }
-dontwarn javazoom.jl.**
-keep class com.google.protobuf.** { *; }
-dontwarn com.google.protobuf.**
