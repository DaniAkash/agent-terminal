const { withDangerousMod } = require('@expo/config-plugins')
const fs = require('node:fs')
const path = require('node:path')

/**
 * Pin the generated Android `gradle-wrapper.properties` to a Gradle
 * version compatible with RN 0.85's bundled foojay toolchain resolver.
 *
 * SDK 56's default prebuild emits `distributionUrl=…gradle-9.3.1-bin.zip`,
 * but `@react-native/gradle-plugin@0.85.x`'s `settings.gradle.kts`
 * hard-codes `org.gradle.toolchains.foojay-resolver-convention:0.5.0`.
 * Foojay 0.5.0 pre-dates Gradle 9's removal / rename of
 * `JvmVendorSpec.IBM_SEMERU` → `IBM`. The class initializer for
 * `FoojayApi.DistributionsKt` throws `NoSuchFieldError` before any
 * task even runs, so `expo run:android` fails during Gradle's
 * settings-evaluation phase with no useful surface error.
 *
 * Pin Gradle to the last 8.x release where the old constant still
 * exists so foojay 0.5.0 keeps working. Revert this plugin (or bump
 * the version) once RN ships with foojay >= 0.9.x (Gradle 9 support).
 * SDK 57 / RN 0.86+ is expected to include the newer resolver.
 *
 * Applied via `withDangerousMod` because `expo-build-properties` does
 * not expose a `gradleWrapperVersion` knob in 57.x.
 */
module.exports = function withGradleWrapperVersion(
  config,
  { version = '8.14.3' } = {},
) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const p = path.join(
        cfg.modRequest.platformProjectRoot,
        'gradle',
        'wrapper',
        'gradle-wrapper.properties',
      )
      const src = fs.readFileSync(p, 'utf8')
      const patched = src.replace(
        /distributionUrl=.+/,
        `distributionUrl=https\\://services.gradle.org/distributions/gradle-${version}-bin.zip`,
      )
      fs.writeFileSync(p, patched)
      return cfg
    },
  ])
}
