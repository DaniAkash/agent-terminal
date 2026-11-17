const { getDefaultConfig } = require('expo/metro-config')
const { withUniwindConfig } = require('uniwind/metro')

const config = getDefaultConfig(__dirname)

// The libghostty core is a .wasm binary the terminal DOM component loads at
// runtime. It is treated as source rather than as an asset because the asset
// pipeline does not reach a DOM component's bundle: `expo export` emitted the
// component's HTML, JS and CSS and left the binary out, so release builds
// fetched a file that was not in the app. The transformer inlines it as a
// data URI, which ships the bytes with the code that needs them.
config.resolver.sourceExts.push('wasm')
config.transformer.babelTransformerPath = require.resolve(
  './metro-wasm-transformer.js',
)

module.exports = withUniwindConfig(config, {
  cssEntryFile: './global.css',
  dtsFile: './uniwind-types.d.ts',
})
