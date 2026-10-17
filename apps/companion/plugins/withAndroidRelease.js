const {
  withAppBuildGradle,
  withGradleProperties,
} = require('@expo/config-plugins')

/**
 * Teach the generated `android/app/build.gradle` to sign release builds
 * with the Play upload key, and to ship native debug symbols.
 *
 * Both edits have to live in a plugin rather than in the generated tree,
 * because `expo prebuild --clean` rewrites that tree from the template on
 * every run and would discard anything edited by hand.
 *
 * Signing values come from `android/keystore.properties`, which is
 * gitignored and written by CI from secrets. When that file is absent the
 * release build falls back to the debug key, exactly as the stock Expo
 * template does, so a fresh clone still builds and installs. Play will not
 * accept a debug-signed bundle, which is the correct place for that to
 * fail: at upload, loudly, rather than at build time on someone's laptop.
 *
 * Each edit anchors on a known line from the template and throws if the
 * anchor is gone, so an Expo template change surfaces as a plugin error
 * rather than a release that silently ships unsigned.
 */
module.exports = function withAndroidRelease(config) {
  return withBundlingHeadroom(withReleaseSigning(config))
}

function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') {
      throw new Error(
        `withAndroidRelease: expected a Groovy build.gradle, got ${cfg.modResults.language}. ` +
          `Expo switched the Android template to Kotlin DSL; port the four edits in this plugin.`,
      )
    }

    let src = cfg.modResults.contents

    // 1. Load the properties file. Must sit above `android {` so the
    //    signingConfigs and buildTypes blocks below can both see it.
    const androidBlock = /^android \{$/m
    if (!androidBlock.test(src)) {
      throw new Error(
        'withAndroidRelease: no top-level `android {` line in app/build.gradle. Template drift; update the anchor.',
      )
    }
    src = src.replace(
      androidBlock,
      `def keystorePropertiesFile = rootProject.file("keystore.properties")
def keystoreProperties = new Properties()
if (keystorePropertiesFile.exists()) {
    keystorePropertiesFile.withInputStream { keystoreProperties.load(it) }
}

android {`,
    )

    // 2. Add a `release` signing config beside the template's `debug` one.
    //    Defined only when the properties file exists, so that referencing
    //    `signingConfigs.release` is always either valid or unreachable.
    const debugSigning = `    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }`
    if (!src.includes(debugSigning)) {
      throw new Error(
        'withAndroidRelease: the template `signingConfigs { debug { … } }` block was not found verbatim. Template drift; update the anchor.',
      )
    }
    src = src.replace(
      debugSigning,
      `    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
        if (keystorePropertiesFile.exists()) {
            release {
                // An absolute storeFile is left untouched by file(), which is
                // what CI writes; a relative one resolves from the app module.
                storeFile file(keystoreProperties['storeFile'])
                storePassword keystoreProperties['storePassword']
                keyAlias keystoreProperties['keyAlias']
                keyPassword keystoreProperties['keyPassword']
            }
        }
    }`,
    )

    // 3. Point the release build type at that config, and ship native
    //    debug symbols. Anchored on the template's own comment so the
    //    identical `signingConfig signingConfigs.debug` line in the debug
    //    build type cannot be matched by accident.
    const releaseSigning = `        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug`
    if (!src.includes(releaseSigning)) {
      throw new Error(
        'withAndroidRelease: the template release buildType signing lines were not found verbatim. Template drift; update the anchor.',
      )
    }
    src = src.replace(
      releaseSigning,
      `        release {
            signingConfig keystorePropertiesFile.exists() ? signingConfigs.release : signingConfigs.debug
            // Hermes and the React Native core ship native code, so Play
            // warns about missing symbols on every upload without this.
            // SYMBOL_TABLE rather than FULL: it gives function names in a
            // native crash, which is the part anyone can act on, without
            // the line-number tables that made packageReleaseBundle run
            // out of heap. All of this native code is third party, so the
            // line numbers would point into code we do not maintain.
            ndk {
                debugSymbolLevel "SYMBOL_TABLE"
            }`,
    )

    cfg.modResults.contents = src
    return cfg
  })
}

/**
 * Raise the Gradle JVM heap for release bundling.
 *
 * Expo's template ships `-Xmx2048m`, which is enough for a debug build but
 * not for `packageReleaseBundle`: with native debug symbols extracted for
 * Hermes and the React Native core, the packaging step exhausted the heap
 * and took the daemon with it, surfacing as "Gradle build daemon
 * disappeared unexpectedly" rather than as an out-of-memory error.
 */
function withBundlingHeadroom(config) {
  return withGradleProperties(config, (cfg) => {
    const JVM_ARGS = 'org.gradle.jvmargs'
    const entry = cfg.modResults.find(
      (item) => item.type === 'property' && item.key === JVM_ARGS,
    )
    if (!entry) {
      throw new Error(
        `withAndroidRelease: no ${JVM_ARGS} in gradle.properties. Template drift; the heap bump has nothing to replace.`,
      )
    }
    entry.value = '-Xmx4096m -XX:MaxMetaspaceSize=1024m'
    return cfg
  })
}
