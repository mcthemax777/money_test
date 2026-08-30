module.exports = function (api) {
  api.cache(true);
  return {
    // nativewind 프리셋이 className 을 스타일로 바꾼다.
    presets: [['babel-preset-expo', { jsxImportSource: 'nativewind' }], 'nativewind/babel'],
    // reanimated(=nativewind 의 애니메이션)가 요구한다. 언제나 맨 뒤여야 한다.
    plugins: ['react-native-worklets/plugin'],
  };
};
