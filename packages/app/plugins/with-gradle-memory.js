/*
 * gradle 데몬의 메모리를 늘린다.
 *
 * Expo 템플릿의 gradle.properties 는 `-Xmx2048m -XX:MaxMetaspaceSize=512m` 이다.
 * Firebase Crashlytics gradle 플러그인을 넣은 뒤(2026-10-10) 릴리스 빌드가 "Metaspace"
 * 하나만 남기고 죽었다. android/ 는 prebuild 가 다시 만드는 자리라 거기서 고치면 사라지므로
 * prebuild 때마다 여기서 넣는다. 4096m/1024m 로 assembleRelease 가 통과한 것을 확인했다.
 */
const { withGradleProperties } = require('@expo/config-plugins');

const JVM_ARGS = '-Xmx4096m -XX:MaxMetaspaceSize=1024m';

module.exports = function withGradleMemory(config) {
  return withGradleProperties(config, (config) => {
    const props = config.modResults.filter(
      (item) => !(item.type === 'property' && item.key === 'org.gradle.jvmargs'),
    );
    props.push({ type: 'property', key: 'org.gradle.jvmargs', value: JVM_ARGS });
    config.modResults = props;
    return config;
  });
};
