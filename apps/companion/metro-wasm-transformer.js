const fs = require('node:fs')

// Resolved through Expo's own default config rather than by importing
// @expo/metro-config directly, so this keeps delegating to whichever
// transformer the installed SDK uses and adds no dependency of its own.
let upstream
function getUpstream() {
  if (!upstream) {
    const { getDefaultConfig } = require('expo/metro-config')
    const path = getDefaultConfig(__dirname).transformer.babelTransformerPath
    upstream = require(path)
  }
  return upstream
}

// The terminal's libghostty core is a .wasm binary, and a DOM component is
// the one bundle Metro's asset pipeline does not reach: `expo export` emits
// the component's HTML, JS and CSS and leaves the binary out, so a release
// build fetched a URL for a file that was never shipped and the terminal
// never booted. Debug builds hid it, because there the dev server had the
// binary on disk to hand back.
//
// Inlining it as a data URI ships the bytes with the code that needs them,
// which also removes the gap between what the dev server can serve and what
// the app bundle actually contains.
function transform(params) {
  const next = getUpstream()
  if (!params.filename.endsWith('.wasm')) return next.transform(params)
  const base64 = fs.readFileSync(params.filename).toString('base64')
  return next.transform({
    ...params,
    src: `module.exports = "data:application/wasm;base64,${base64}";`,
  })
}

module.exports = { transform }
