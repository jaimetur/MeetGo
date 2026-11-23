plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

// Push notifications (Firebase Cloud Messaging) need app/google-services.json, from the Firebase console (git-ignored;
// CI writes it from the GOOGLE_SERVICES_JSON_B64 secret). Without it the app builds the same and push is unavailable.
if (file("google-services.json").exists()) {
    apply(plugin = "com.google.gms.google-services")
}

android {
    namespace = "app.meetgo.android"
    compileSdk = 36

    defaultConfig {
        applicationId = "app.meetgo.android"
        minSdk = 28
        targetSdk = 36
        // the patch is the CI build number; tools/CreateUpdateRelease.py rewrites the major.minor
        versionCode = (System.getenv("MEETGO_ANDROID_BUILD") ?: "1").toInt()
        versionName = "0.2." + (System.getenv("MEETGO_ANDROID_BUILD") ?: "0")
    }

    // in CI, if the keystore is in the secrets, the app is signed with it; otherwise with the debug key
    val ks = System.getenv("ANDROID_KEYSTORE_FILE")?.let { file(it) }?.takeIf { it.exists() }
    signingConfigs {
        if (ks != null) create("release") {
            storeFile = ks
            storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
            keyAlias = System.getenv("ANDROID_KEY_ALIAS")
            keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName(if (ks != null) "release" else "debug")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { compose = true }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation(platform("androidx.compose:compose-bom:2024.12.01"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.core:core-splashscreen:1.0.1")
    implementation("com.android.billingclient:billing-ktx:8.0.0")
    implementation("androidx.fragment:fragment-ktx:1.8.5")   // activity results need Fragment 1.3+ (lint)
    implementation(platform("com.google.firebase:firebase-bom:33.7.0"))
    implementation("com.google.firebase:firebase-messaging")
}
