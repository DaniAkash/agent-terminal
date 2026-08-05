module.exports = (api) => {
  api.cache(true)
  return {
    presets: ['babel-preset-expo'],
    // react-native-worklets (used by react-native-reanimated 4.x) MUST be
    // the LAST plugin. Otherwise animation callbacks run on the JS
    // thread and drag-to-reorder feels sluggish or hangs.
    plugins: ['react-native-worklets/plugin'],
  }
}
