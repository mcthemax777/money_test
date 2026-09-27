/**
 * 관리자 비밀번호 해시. scrypt 로 만들고 `scrypt$<salt hex>$<hash hex>` 로 적는다.
 *
 * 새 의존성 없이 Node 의 crypto 만 쓴다. 비교는 시간이 같게 한다(timingSafeEqual).
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const KEY_LENGTH = 64;

export function hashAdminPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

/** 해시와 맞는가. 모양이 어긋난 해시는 늘 틀린 것으로 본다. */
export function verifyAdminPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;

  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return expected.length === KEY_LENGTH && timingSafeEqual(actual, expected);
}
