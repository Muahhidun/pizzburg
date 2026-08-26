import java.util.Properties

plugins {
    id("com.android.application")
    id("kotlin-android")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// Пароли и путь к ключу подписи лежат в key.properties рядом с этим
// файлом. В репозиторий он не попадает: потеря ключа означает, что
// обновление приложения выпустить уже нельзя.
val keystoreProperties = Properties().apply {
    val file = rootProject.file("key.properties")
    if (file.exists()) file.inputStream().use { load(it) }
}

android {
    namespace = "kz.pizzburg.pizzburg"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = JavaVersion.VERSION_17.toString()
    }

    defaultConfig {
        applicationId = "kz.pizzburg.pizzburg"
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        create("release") {
            keystoreProperties.getProperty("keyAlias")?.let { keyAlias = it }
            keystoreProperties.getProperty("keyPassword")?.let { keyPassword = it }
            keystoreProperties.getProperty("storeFile")?.let { storeFile = file(it) }
            keystoreProperties.getProperty("storePassword")?.let { storePassword = it }
        }
    }

    buildTypes {
        release {
            // Без key.properties подписать нечем. Раньше здесь стоял
            // отладочный ключ, и такую сборку Google Play отклоняет —
            // молчаливая подмена хуже понятной ошибки сборки.
            signingConfig = if (keystoreProperties.isEmpty) {
                signingConfigs.getByName("debug")
            } else {
                signingConfigs.getByName("release")
            }
        }
    }
}

flutter {
    source = "../.."
}
