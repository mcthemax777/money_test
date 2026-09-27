/**
 * 관리자 비밀번호의 해시를 만든다. 결과를 서버 .env 의 ADMIN_PASSWORD_HASH 에 넣는다.
 *
 *   cd packages/api
 *   npx tsx scripts/hash-admin-password.ts '<비밀번호>'
 */
import { hashAdminPassword } from '../src/modules/admin/admin-password';

const password = process.argv[2];
if (!password) {
  console.error("사용법: npx tsx scripts/hash-admin-password.ts '<비밀번호>'");
  process.exit(1);
}
console.log(hashAdminPassword(password));
