-- 과소비·추가 수입 기능을 걷어낸다.
--
-- 지출의 "과소비", 수입의 "추가 수입"을 금액으로 적던 기능이다. 다리마다 그 몫을
-- 두고(extraAmount), 나머지를 함께 저장해(normalAmount) 합계와 목록을 양쪽으로
-- 갈라 보여 주었다. 분류에는 그 기본값(defaultIsExtra)이 붙어 있었다.
--
-- **적어 둔 금액은 되돌릴 수 없다.** 컬럼을 지우므로 "이 거래의 3만 원은 과소비였다"는
-- 기록이 함께 사라진다. 거래 자체와 금액은 그대로다 -- 사라지는 것은 그 안의 구분뿐이다.
ALTER TABLE "Posting" DROP COLUMN "extraAmount";
ALTER TABLE "Posting" DROP COLUMN "normalAmount";
ALTER TABLE "Category" DROP COLUMN "defaultIsExtra";
