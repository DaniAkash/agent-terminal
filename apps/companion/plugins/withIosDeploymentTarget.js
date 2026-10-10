const { withDangerousMod } = require('@expo/config-plugins')
const fs = require('node:fs')
const path = require('node:path')

/**
 * Raise `IPHONEOS_DEPLOYMENT_TARGET` on every generated Pods target,
 * including the resource-bundle targets CocoaPods synthesises.
 *
 * Xcode 27 rejects any deployment target below 15.0 outright, where 26
 * only warned. `@react-native-async-storage/async-storage@2.2.0` still
 * declares `s.platforms = { ios: '13.4' }`, and because it also declares
 * a `resource_bundles` entry for its privacy manifest, CocoaPods emits a
 * separate `RNCAsyncStorage-RNCAsyncStorage_resources` target that
 * inherits that floor. `expo run:ios` then dies at the planning stage
 * with xcodebuild error 65 before a single file compiles.
 *
 * The Podfile's own `platform :ios` line does not reach these targets,
 * and neither does `react_native_post_install`, which is why the main
 * pod targets build fine while the bundle target fails. Five installed
 * podspecs declare `resource_bundles`; async-storage merely has the
 * lowest floor, so it fails first. Normalising every target covers the
 * rest before they surface.
 *
 * `expo-build-properties`' `ios.deploymentTarget` cannot do this: it
 * only edits the app's Xcode project, which prebuild writes before
 * CocoaPods generates the Pods project at all.
 *
 * Remove this plugin once Expo's SDK pin moves to an async-storage
 * release whose podspec floor is at or above 15.0. SDK 56, 57 and 58 all
 * still pin 2.2.0, so that is not imminent.
 *
 * Applied via `withDangerousMod` because the generated `ios/` tree is
 * gitignored and rewritten on every prebuild, so a direct Podfile edit
 * would not survive. Mirrors `withGradleWrapperVersion` on the Android
 * side, which exists for the same reason.
 */
module.exports = function withIosDeploymentTarget(
  config,
  { deploymentTarget = '16.4' } = {},
) {
  return withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const p = path.join(cfg.modRequest.platformProjectRoot, 'Podfile')
      const src = fs.readFileSync(p, 'utf8')

      // Anchor on the post_install block Expo's template opens, and inject
      // the normalisation as its first statement so it runs before
      // react_native_post_install reads any build settings. Verify the
      // anchor matched: a template drift that silently no-ops here would
      // bring the Xcode 27 build failure straight back.
      // `[ \t]*` rather than `\s*`: `\s` matches newlines, so a greedy
      // capture would swallow the preceding blank line into the indent and
      // re-emit it before every injected line.
      const pattern = /^([ \t]*)post_install do \|installer\|$/m
      if (!pattern.test(src)) {
        throw new Error(
          `withIosDeploymentTarget: post_install block not found in ${p}. ` +
            `Expo's Podfile template may have changed shape; update the ` +
            `plugin's anchor or drop it if the upstream floor was raised.`,
        )
      }

      const patched = src.replace(pattern, (_m, indent) =>
        [
          `${indent}post_install do |installer|`,
          `${indent}  installer.pods_project.targets.each do |target|`,
          `${indent}    target.build_configurations.each do |cfg|`,
          `${indent}      current = cfg.build_settings['IPHONEOS_DEPLOYMENT_TARGET']`,
          `${indent}      if current.nil? || current.to_f < ${deploymentTarget}`,
          `${indent}        cfg.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '${deploymentTarget}'`,
          `${indent}      end`,
          `${indent}    end`,
          `${indent}  end`,
        ].join('\n'),
      )

      fs.writeFileSync(p, patched)
      return cfg
    },
  ])
}
