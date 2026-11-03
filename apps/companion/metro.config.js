const { getDefaultConfig } = require('expo/metro-config')
const { withUniwindConfig } = require('uniwind/metro')

const config = getDefaultConfig(__dirname)

// The libghostty core is a .wasm binary that the terminal DOM component
// fetches at runtime. Metro treats unknown extensions as source, so it
// has to be registered as an asset for the bundler to emit it and hand
// back a URL.
config.resolver.assetExts.push('wasm')

module.exports = withUniwindConfig(config, {
  cssEntryFile: './global.css',
  dtsFile: './uniwind-types.d.ts',
})
