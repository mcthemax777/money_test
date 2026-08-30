/*
 * 앱을 우리 키로 서명한다 (릴리스와 디버그 모두).
 *
 * Expo 템플릿이 넣어 주는 debug.keystore 는 2014년에 만들어져 템플릿에 그대로 실려
 * 있는 것이라, 이 템플릿으로 만든 세상 모든 앱이 같은 지문을 쓴다. 구글 콘솔은
 * (패키지 이름, 서명 지문) 쌍이 겹치는 것을 거절하므로, 그 키로는 안드로이드
 * OAuth 클라이언트를 등록하지 못한다("이미 사용 중입니다").
 *
 * android/ 는 prebuild 가 다시 만드는 자리라 그 안에 키를 두면 사라진다. 키와
 * 비밀번호는 credentials/ 에 두고(저장소에 넣지 않는다), prebuild 때 여기서 넣는다.
 * credentials/ 가 없으면 아무것도 하지 않는다. 템플릿의 디버그 키로 그냥 빌드된다.
 */
const fs = require('fs');
const path = require('path');
const { withAppBuildGradle, withDangerousMod } = require('@expo/config-plugins');

const CREDENTIALS_DIR = 'credentials';
const KEYSTORE_FILE = 'release.keystore';
const CONFIG_FILE = 'keystore.json';

function readCredentials(projectRoot) {
  const configPath = path.join(projectRoot, CREDENTIALS_DIR, CONFIG_FILE);
  const keystorePath = path.join(projectRoot, CREDENTIALS_DIR, KEYSTORE_FILE);
  if (!fs.existsSync(configPath) || !fs.existsSync(keystorePath)) return null;

  return { ...JSON.parse(fs.readFileSync(configPath, 'utf8')), keystorePath };
}

module.exports = function withSigning(config) {
  // 키스토어 파일을 android/app 으로 옮긴다. build.gradle 이 그 자리를 본다.
  config = withDangerousMod(config, [
    'android',
    (config) => {
      const credentials = readCredentials(config.modRequest.projectRoot);
      if (!credentials) return config;

      fs.copyFileSync(
        credentials.keystorePath,
        path.join(config.modRequest.platformProjectRoot, 'app', KEYSTORE_FILE),
      );
      return config;
    },
  ]);

  // signingConfigs 에 release 를 더하고, 릴리스 빌드가 디버그 키 대신 그것을 쓰게 한다.
  return withAppBuildGradle(config, (config) => {
    const credentials = readCredentials(config.modRequest.projectRoot);
    if (!credentials) {
      console.warn(
        `[with-signing] ${CREDENTIALS_DIR}/ 가 없어 템플릿 디버그 키로 서명합니다.`,
      );
      return config;
    }

    const debugBlockEnd = `            keyPassword 'android'\n        }\n    }`;
    const releaseBlock =
      `            keyPassword 'android'\n        }\n` +
      `        release {\n` +
      `            storeFile file('${KEYSTORE_FILE}')\n` +
      `            storePassword '${credentials.storePassword}'\n` +
      `            keyAlias '${credentials.keyAlias}'\n` +
      `            keyPassword '${credentials.keyPassword}'\n` +
      `        }\n    }`;

    let contents = config.modResults.contents;
    if (!contents.includes(debugBlockEnd)) {
      throw new Error('[with-signing] signingConfigs 블록을 찾지 못했습니다.');
    }
    contents = contents.replace(debugBlockEnd, releaseBlock);

    /*
     * 릴리스와 디버그 둘 다 우리 키로 서명한다.
     *
     * 구글은 패키지 이름과 서명 지문으로 앱을 알아본다. 디버그를 템플릿 키로 두면
     * 그 지문은 콘솔에 등록할 수 없어(세상 모든 Expo 앱이 공유한다) 개발 중에는
     * 구글 로그인이 되지 않는다. 같은 키를 쓰면 디버그와 릴리스를 덮어 설치할 수도 있다.
     */
    const releaseUsesDebugKey =
      '        release {\n            // Caution! In production, you need to generate your own keystore file.\n' +
      '            // see https://reactnative.dev/docs/signed-apk-android.\n' +
      '            signingConfig signingConfigs.debug';
    if (!contents.includes(releaseUsesDebugKey)) {
      throw new Error('[with-signing] buildTypes.release 를 찾지 못했습니다.');
    }
    contents = contents.replace(
      releaseUsesDebugKey,
      '        release {\n            signingConfig signingConfigs.release',
    );

    const debugUsesDebugKey = '        debug {\n            signingConfig signingConfigs.debug';
    if (!contents.includes(debugUsesDebugKey)) {
      throw new Error('[with-signing] buildTypes.debug 를 찾지 못했습니다.');
    }
    contents = contents.replace(
      debugUsesDebugKey,
      '        debug {\n            signingConfig signingConfigs.release',
    );

    config.modResults.contents = contents;
    return config;
  });
};
