plugins {
    id("com.android.application") version "8.9.1" apply false
    id("org.jetbrains.kotlin.android") version "2.1.0" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.1.0" apply false
    // applied by app/build.gradle.kts only when app/google-services.json exists (push notifications)
    id("com.google.gms.google-services") version "4.4.2" apply false
}
