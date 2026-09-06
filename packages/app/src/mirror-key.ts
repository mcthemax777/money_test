/*
 * 사본에 딸린, 파일과 함께 버려야 하는 값들. 열쇠와 주인이다.
 *
 * 기기 사본(money-local.db)은 SQLCipher 로 암호화되어 있다. 그 열쇠를 여기서 만들고
 * 보관한다. **파일 옆에 두면 뜻이 없으므로** 안드로이드 키스토어·iOS 키체인이 지키는
 * SecureStore 에 넣는다 (토큰과 같은 자리다).
 *
 * 열쇠는 **원본 키**로 준다 -- 암호를 주면 SQLCipher 가 PBKDF2 로 25만 번쯤 늘려 키를
 * 만드는데, 그 비용이 사본을 열 때마다 든다. 우리는 사람이 외울 암호가 아니라 난수를
 * 쓰므로 늘릴 이유가 없다. 64자 16진수가 곧 256비트 키다.
 *
 * **열쇠를 잃으면 사본을 못 연다.** 그래도 잃는 것은 없다 -- 사본은 서버에서 다시 받을
 * 수 있는 캐시다. 그래서 여는 쪽(`sqlite.ts`)은 열리지 않으면 파일을 버리고 새로 만든다.
 */
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

/** SecureStore 안에서의 이름. 토큰들과 같은 저장소를 쓴다. */
const KEY_NAME = 'mirrorKey';

/**
 * 이 사본이 누구의 것인가.
 *
 * **로그인 스토어가 아니라 여기에 둔다.** 토큰이 만료되어(401) 세션이 끊기면 그 스토어의
 * 사용자는 비워지고, 그 뒤에 다른 계정이 들어오면 "주인이 바뀌었다"를 알 길이 없다.
 * 그러면 앞 사람의 가계부가 남은 사본 위로 새 사람의 데이터가 얹힌다 (설계 문서의 D10).
 *
 * 사본 파일 옆이 아니라 SecureStore 인 것은 파일을 부수는 경로(스키마 판 올림의 rebuild)가
 * 있기 때문이다. 그 경로는 표를 다시 세우므로 표 안에 둔 값은 사라진다.
 */
const OWNER_NAME = 'mirrorOwner';

/** 256비트. SQLCipher 의 원본 키 길이다. */
const KEY_BYTES = 32;

/** 이 실행에서 한 번만 읽는다. 사본을 열 때마다 키체인을 두드릴 이유가 없다. */
let cached: string | null = null;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * 이 기기의 열쇠. 없으면 만들어 넣는다.
 *
 * 돌려주는 것은 64자 16진수다. 부르는 쪽이 `PRAGMA key = "x'...'"` 에 그대로 끼운다.
 */
export async function mirrorKey(): Promise<string> {
  if (cached) return cached;

  const stored = await SecureStore.getItemAsync(KEY_NAME);
  if (stored && /^[0-9a-f]{64}$/.test(stored)) {
    cached = stored;
    return stored;
  }

  const made = toHex(Crypto.getRandomBytes(KEY_BYTES));
  /*
   * 잠금 해제 뒤에만 읽을 수 있게 둔다.
   *
   * 사본을 여는 것은 앱이 화면에 있을 때뿐이라 이 조건으로 충분하고, 잠긴 기기에서
   * 꺼내 가는 길을 하나 줄인다. 기기 간 이동은 하지 않는다 -- 다른 기기의 사본은
   * 그 기기가 서버에서 다시 받으면 된다.
   */
  await SecureStore.setItemAsync(KEY_NAME, made, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  cached = made;
  return made;
}

/** 지금 사본의 주인. 아직 아무도 없으면 null. */
export async function mirrorOwner(): Promise<string | null> {
  return SecureStore.getItemAsync(OWNER_NAME);
}

/** 이 사용자의 사본으로 표시한다. 로그인할 때마다 부른다(같은 값이면 그대로다). */
export async function claimMirrorOwner(userId: string): Promise<void> {
  if (!userId) return;
  await SecureStore.setItemAsync(OWNER_NAME, userId, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

/**
 * 열쇠와 주인을 버린다. 사본 파일을 지울 때 함께 부른다.
 *
 * 남겨 두면 다음 사용자의 사본이 지난 사용자의 열쇠로 잠기고, 주인도 앞 사람으로 남는다.
 * 사본을 버리는 뜻이 "지난 사용자의 흔적을 지운다"라서 둘 다 같이 간다 (D10).
 */
export async function clearMirrorKey(): Promise<void> {
  cached = null;
  await SecureStore.deleteItemAsync(KEY_NAME);
  await SecureStore.deleteItemAsync(OWNER_NAME);
}
