/*
 * 모노레포용 Metro 설정.
 *
 * 두 가지를 한다.
 *   1. 워크스페이스 전체를 지켜본다. @money/core 는 packages/core 에 있고 심볼릭
 *      링크로 걸려 있어, 기본 설정은 그 파일이 바뀌어도 알아채지 못한다.
 *   2. react 와 react-native 은 앱의 것 하나만 쓰게 한다. pnpm 은 패키지마다
 *      의존성을 따로 두므로, core 나 zustand 가 각자의 react 를 끌어오면 훅이
 *      다른 react 인스턴스에서 돌아 "Invalid hook call" 로 죽는다.
 */
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

/** 앱의 것 하나만 써야 하는 패키지. 값은 그 패키지가 있는 자리다. */
const SINGLETONS = {
  react: path.resolve(projectRoot, 'node_modules/react'),
  'react-native': path.resolve(projectRoot, 'node_modules/react-native'),
};

config.resolver.resolveRequest = (context, moduleName, platform) => {
  for (const [name, dir] of Object.entries(SINGLETONS)) {
    if (moduleName === name || moduleName.startsWith(`${name}/`)) {
      return context.resolveRequest(context, dir + moduleName.slice(name.length), platform);
    }
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = withNativeWind(config, { input: './global.css' });
