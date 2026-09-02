/*
 * core 를 이 기기에 맞춰 놓는 자리.
 *
 * 웹은 쿠키와 빌드 시 환경변수를 쓰지만 앱에는 둘 다 없다. 시작할 때 여기서
 * 서버 주소와 토큰 저장소, 세션이 끊겼을 때 할 일을 넣어 준다.
 */
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import * as Crypto from 'expo-crypto';

import { apiClient } from '@money/core/lib/api-client';
import { setTokenStorage } from '@money/core/lib/auth-tokens';
import { setRandomBytes } from '@money/types';
import { hydrateTokens, secureTokenStorage } from './token-storage';

/**
 * 볼 수 있는 서버.
 *
 * 주소와 구글 웹 클라이언트 ID 는 한 짝이다. 두 서버가 같은 구글 프로젝트의 서로
 * 다른 클라이언트를 쓰기 때문에, 따로 바꾸다 어긋나면 구글은 토큰을 주는데 서버가
 * 401 로 거절한다. 그래서 둘을 묶어 두고 아래 SERVER 한 줄로 고른다.
 */
const SERVERS = {
  /**
   * 이 맥에서 도는 API. USB 로 넘긴다.
   *
   * `adb reverse tcp:3001 tcp:3001` 을 걸어 두면 기기의 localhost:3001 이 맥의
   * 3001 로 이어진다. 랜 주소를 적어 두면 와이파이가 바뀔 때마다 값을 고쳐야
   * 하지만, 이 방법은 케이블만 꽂혀 있으면 되고 에뮬레이터에서도 똑같이 된다.
   *
   * 평문(http)이라 릴리스 빌드로는 닿지 않는다. 출시본에서 평문을 막아 두었기
   * 때문이다. 로컬 서버를 볼 때는 디버그 빌드로 띄운다.
   */
  local: {
    apiUrl: 'http://localhost:3001',
    googleWebClientId: '183293757909-g5mjgmv67f4p88kktsamd72iv47gcn2q.apps.googleusercontent.com',
  },
  /** 배포 서버. 그 호스트는 /api 로 오는 것만 API 로 넘긴다. */
  deployed: {
    apiUrl: 'https://bboyong.online/api',
    googleWebClientId: '183293757909-5km72508a6ttn2bgk5il5p7neinejjv3.apps.googleusercontent.com',
  },
} as const;

/** 지금 보는 서버. 바꿀 때는 이 줄만 고치고 다시 빌드한다. */
const SERVER = SERVERS.deployed;

export const API_URL = SERVER.apiUrl;

/**
 * 구글 로그인의 웹 클라이언트 ID.
 *
 * 이 값을 webClientId 로 넘겨야 구글이 주는 ID 토큰의 aud 가 위 서버의
 * GOOGLE_CLIENT_IDS 와 맞는다. 안드로이드 클라이언트 ID 는 코드에 적지 않는다.
 * 구글이 패키지 이름과 서명 지문으로 알아서 고른다.
 *
 * 비밀이 아니다. 웹에서도 브라우저로 그대로 내려간다.
 */
export const GOOGLE_WEB_CLIENT_ID = SERVER.googleWebClientId;

export async function setupApi(onUnauthorized: () => void): Promise<void> {
  await hydrateTokens();
  setTokenStorage(secureTokenStorage);

  /*
   * 기기가 만드는 id 에 쓸 난수원.
   *
   * Hermes 에는 `crypto.getRandomValues` 가 없다(Expo 의 winter 런타임에도 없다).
   * 넣지 않으면 id 를 만들 수 없어 서버가 만든 id 를 받게 되고, 오프라인 입력이
   * 그만큼 늦어진다.
   */
  setRandomBytes((byteCount) => Crypto.getRandomBytes(byteCount));
  apiClient.setBaseUrl(API_URL);
  apiClient.setUnauthorizedHandler(onUnauthorized);

  // 로그인 화면이 뜨기 전에 해 둔다. configure 는 그 자리에서 끝나는 설정이다.
  GoogleSignin.configure({ webClientId: GOOGLE_WEB_CLIENT_ID });
}
