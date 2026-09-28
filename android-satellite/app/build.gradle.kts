plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.juanes.cronos"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.juanes.cronos"
        minSdk = 24
        targetSdk = 34
        versionCode = 2
        versionName = "1.2.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        viewBinding = false
    }
    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
            excludes += "log4j2.xml"
            excludes += "META-INF/INDEX.LIST"
        }
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.12.0")
    implementation("androidx.appcompat:appcompat:1.6.1")
    implementation("com.google.android.material:material:1.11.0")
    implementation("androidx.webkit:webkit:1.10.0")

    // WebSocket client for direct communication with Atlas Server
    implementation("com.squareup.okhttp3:okhttp:4.12.0")

    // Coroutines
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.7.3")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")

    // Librespot for Spotify Connect
    implementation("xyz.gianlu.librespot:librespot-lib:1.6.5") {
        exclude(group = "org.slf4j", module = "slf4j-log4j12")
    }
    implementation("xyz.gianlu.librespot:librespot-player:1.6.5:thin") {
        exclude(group = "com.googlecode.soundlibs", module = "tritonus-share")
        exclude(group = "com.googlecode.soundlibs", module = "vorbisspi")
        exclude(group = "org.slf4j", module = "slf4j-log4j12")
        exclude(group = "org.apache.logging.log4j")
        exclude(group = "com.lmax", module = "disruptor")
        exclude(group = "xyz.gianlu.librespot", module = "librespot-sink")
        exclude(group = "xyz.gianlu.librespot", module = "librespot-dacp")
    }
    implementation("org.slf4j:slf4j-android:1.7.36")
}
