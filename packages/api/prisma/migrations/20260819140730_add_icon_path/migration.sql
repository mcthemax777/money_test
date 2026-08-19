-- AlterTable
ALTER TABLE "FinancialInstitution" ADD COLUMN     "iconPath" TEXT;

-- 각 기관에 아이콘 경로 할당
UPDATE "FinancialInstitution" SET "iconPath" = CASE "id"
  -- 은행
  WHEN 'fi_bank_kb' THEN '/icons/banks/fi_bank_kb.svg'
  WHEN 'fi_bank_shinhan' THEN '/icons/banks/fi_bank_shinhan.svg'
  WHEN 'fi_bank_hana' THEN '/icons/banks/fi_bank_hana.svg'
  WHEN 'fi_bank_woori' THEN '/icons/banks/fi_bank_woori.svg'
  WHEN 'fi_bank_sc' THEN '/icons/banks/fi_bank_sc.svg'
  WHEN 'fi_bank_kakao' THEN '/icons/banks/fi_bank_kakao.svg'
  WHEN 'fi_bank_k' THEN '/icons/banks/fi_bank_k.svg'
  WHEN 'fi_bank_toss' THEN '/icons/banks/fi_bank_toss.svg'
  WHEN 'fi_bank_nh' THEN '/icons/banks/fi_bank_nh.svg'
  WHEN 'fi_bank_ibk' THEN '/icons/banks/fi_bank_ibk.svg'
  WHEN 'fi_bank_kdb' THEN '/icons/banks/fi_bank_kdb.svg'
  WHEN 'fi_bank_sh' THEN '/icons/banks/fi_bank_sh.svg'
  WHEN 'fi_bank_busan' THEN '/icons/banks/fi_bank_busan.svg'
  WHEN 'fi_bank_kyongnam' THEN '/icons/banks/fi_bank_kyongnam.svg'
  WHEN 'fi_bank_im' THEN '/icons/banks/fi_bank_im.svg'
  WHEN 'fi_bank_kwangju' THEN '/icons/banks/fi_bank_kwangju.svg'
  WHEN 'fi_bank_jeonbuk' THEN '/icons/banks/fi_bank_jeonbuk.svg'
  WHEN 'fi_bank_jeju' THEN '/icons/banks/fi_bank_jeju.svg'
  WHEN 'fi_bank_mg' THEN '/icons/banks/fi_bank_mg.svg'
  WHEN 'fi_bank_cu' THEN '/icons/banks/fi_bank_cu.svg'
  WHEN 'fi_bank_post' THEN '/icons/banks/fi_bank_post.svg'
  -- 카드사
  WHEN 'fi_card_shinhan' THEN '/icons/card-issuers/fi_card_shinhan.svg'
  WHEN 'fi_card_samsung' THEN '/icons/card-issuers/fi_card_samsung.svg'
  WHEN 'fi_card_kb' THEN '/icons/card-issuers/fi_card_kb.svg'
  WHEN 'fi_card_hyundai' THEN '/icons/card-issuers/fi_card_hyundai.svg'
  WHEN 'fi_card_lotte' THEN '/icons/card-issuers/fi_card_lotte.svg'
  WHEN 'fi_card_hana' THEN '/icons/card-issuers/fi_card_hana.svg'
  WHEN 'fi_card_woori' THEN '/icons/card-issuers/fi_card_woori.svg'
  WHEN 'fi_card_bc' THEN '/icons/card-issuers/fi_card_bc.svg'
  WHEN 'fi_card_nh' THEN '/icons/card-issuers/fi_card_nh.svg'
  WHEN 'fi_card_ibk' THEN '/icons/card-issuers/fi_card_ibk.svg'
END WHERE "projectId" IS NULL;
