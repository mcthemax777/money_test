-- 이용약관·개인정보처리방침 동의와 만 14세 이상 확인을 받은 시각 (2026-10-25).
--
-- 개인정보 보호법 §22 는 동의를 받았다는 사실을 운영자가 보일 수 있어야 한다. 새 계정은 동의 없이 만들지 않고
-- (auth.service 의 TERMS_REQUIRED), 이미 있던 계정은 다음 로그인에서 동의하면 그때 채운다. 비어 있으면 이 칸이
-- 생기기 전에 가입한 계정이다.
ALTER TABLE "User" ADD COLUMN "termsAgreedAt" TIMESTAMP(3);
