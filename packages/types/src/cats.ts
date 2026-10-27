/**
 * 고양이 엠블럼. 가계부(프로젝트)마다 45종을 모은다 (2026-10-28 사용자 결정).
 *
 * 서버와 화면이 함께 본다. 서버는 이 표의 미션으로 획득을 판정해 `ProjectCat` 에 적고, 화면은 같은 표로
 * 도감과 걷는 고양이를 그린다. 표가 두 벌이면 화면에 적힌 조건과 실제로 주는 조건이 어긋난다.
 *
 * 품종과 비율은 사용자가 준 CFA_Cat_Breeds_Percentages_1.xlsx 를 따른다. 흔한 품종일수록 쉬운 미션이다 --
 * 인기 그룹 넷(상위 1~5, 6~15, 16~25, 희귀)이 곧 희귀도이고, 희귀 그룹의 뒤쪽 11종은 조건을 숨긴다.
 *
 * 이름은 사전(`cats.breed.<id>`)에, 조건 설명은 `cats.mission.<mission>` 에 있다. 영어 이름은 여기에도 두어
 * 서버 로그와 관리 도구가 읽는다.
 */

export const CAT_RARITIES = ['common', 'popular', 'uncommon', 'rare'] as const;
export type CatRarity = (typeof CAT_RARITIES)[number];

/** 획득 조건. 서버의 판정기(`cats.service`)가 같은 이름으로 하나씩 갖는다. */
export const CAT_MISSIONS = [
  'start',
  'first-entry',
  'first-account',
  'first-card',
  'first-income',
  'first-transfer',
  'custom-category',
  'first-tag',
  'budget',
  'add-person',
  'shared',
  'entries-10',
  'split',
  'recurring',
  'tag-budget',
  'installment',
  'discount',
  'refund',
  'payback',
  'inbox',
  'subcategory',
  'foreign',
  'maturity',
  'valuation',
  'loan',
  'entries-100',
  'entries-1000',
  'streak-7',
  'streak-30',
  'budget-kept',
  'budget-kept-3',
  'accounts-5',
  'net-positive',
  'days-100',
  'night-owl',
  'lucky-7777',
  'new-year',
  'christmas',
  'meow',
  'no-spend-10',
  'busy-day',
  'days-365',
  'collect-20',
  'parade-5',
  'collect-all',
] as const;
export type CatMission = (typeof CAT_MISSIONS)[number];

export interface CatBreedDef {
  /** 저장되는 이름. 바꾸면 이미 얻은 고양이를 잃는다. */
  id: string;
  nameEn: string;
  /** 미국 CFA 등록 비율 추정치(%). 엑셀의 최소값이다. 도감이 희귀도 옆에 적는다. */
  share: number;
  rarity: CatRarity;
  mission: CatMission;
  /** 얻기 전에는 조건을 "???"로 가린다. */
  hidden: boolean;
}

/** 엑셀의 차례 그대로다 -- 흔한 것에서 드문 것으로. 도감도 이 차례로 선다. */
export const CAT_BREEDS: readonly CatBreedDef[] = [
  { id: 'maine-coon', nameEn: 'Maine Coon', share: 15, rarity: 'common', mission: 'start', hidden: false },
  { id: 'ragdoll', nameEn: 'Ragdoll', share: 13, rarity: 'common', mission: 'first-entry', hidden: false },
  { id: 'persian', nameEn: 'Persian', share: 10, rarity: 'common', mission: 'first-account', hidden: false },
  { id: 'exotic', nameEn: 'Exotic', share: 8, rarity: 'common', mission: 'first-card', hidden: false },
  { id: 'devon-rex', nameEn: 'Devon Rex', share: 5, rarity: 'common', mission: 'first-income', hidden: false },

  { id: 'abyssinian', nameEn: 'Abyssinian', share: 3.5, rarity: 'popular', mission: 'first-transfer', hidden: false },
  { id: 'british-shorthair', nameEn: 'British Shorthair', share: 3, rarity: 'popular', mission: 'custom-category', hidden: false },
  { id: 'siberian', nameEn: 'Siberian', share: 2.5, rarity: 'popular', mission: 'first-tag', hidden: false },
  { id: 'american-shorthair', nameEn: 'American Shorthair', share: 2.5, rarity: 'popular', mission: 'budget', hidden: false },
  { id: 'sphynx', nameEn: 'Sphynx', share: 2, rarity: 'popular', mission: 'add-person', hidden: false },
  { id: 'russian-blue', nameEn: 'Russian Blue', share: 1.5, rarity: 'popular', mission: 'shared', hidden: false },
  { id: 'siamese', nameEn: 'Siamese', share: 1.5, rarity: 'popular', mission: 'entries-10', hidden: false },
  { id: 'bengal', nameEn: 'Bengal', share: 1.2, rarity: 'popular', mission: 'split', hidden: false },
  { id: 'norwegian-forest', nameEn: 'Norwegian Forest Cat', share: 1, rarity: 'popular', mission: 'recurring', hidden: false },
  { id: 'scottish-fold', nameEn: 'Scottish Fold', share: 1, rarity: 'popular', mission: 'tag-budget', hidden: false },

  { id: 'birman', nameEn: 'Birman', share: 0.7, rarity: 'uncommon', mission: 'installment', hidden: false },
  { id: 'oriental', nameEn: 'Oriental', share: 0.6, rarity: 'uncommon', mission: 'discount', hidden: false },
  { id: 'burmese', nameEn: 'Burmese', share: 0.5, rarity: 'uncommon', mission: 'refund', hidden: false },
  { id: 'cornish-rex', nameEn: 'Cornish Rex', share: 0.5, rarity: 'uncommon', mission: 'payback', hidden: false },
  { id: 'tonkinese', nameEn: 'Tonkinese', share: 0.4, rarity: 'uncommon', mission: 'inbox', hidden: false },
  { id: 'ocicat', nameEn: 'Ocicat', share: 0.4, rarity: 'uncommon', mission: 'subcategory', hidden: false },
  { id: 'somali', nameEn: 'Somali', share: 0.3, rarity: 'uncommon', mission: 'foreign', hidden: false },
  { id: 'manx', nameEn: 'Manx', share: 0.3, rarity: 'uncommon', mission: 'maturity', hidden: false },
  { id: 'ragamuffin', nameEn: 'RagaMuffin', share: 0.3, rarity: 'uncommon', mission: 'valuation', hidden: false },
  { id: 'selkirk-rex', nameEn: 'Selkirk Rex', share: 0.3, rarity: 'uncommon', mission: 'loan', hidden: false },

  { id: 'chartreux', nameEn: 'Chartreux', share: 0.15, rarity: 'rare', mission: 'entries-100', hidden: false },
  { id: 'egyptian-mau', nameEn: 'Egyptian Mau', share: 0.15, rarity: 'rare', mission: 'entries-1000', hidden: false },
  { id: 'american-curl', nameEn: 'American Curl', share: 0.15, rarity: 'rare', mission: 'streak-7', hidden: false },
  { id: 'american-bobtail', nameEn: 'American Bobtail', share: 0.15, rarity: 'rare', mission: 'streak-30', hidden: false },
  { id: 'japanese-bobtail', nameEn: 'Japanese Bobtail', share: 0.15, rarity: 'rare', mission: 'budget-kept', hidden: false },
  { id: 'turkish-angora', nameEn: 'Turkish Angora', share: 0.15, rarity: 'rare', mission: 'budget-kept-3', hidden: false },
  { id: 'singapura', nameEn: 'Singapura', share: 0.15, rarity: 'rare', mission: 'accounts-5', hidden: false },
  { id: 'bombay', nameEn: 'Bombay', share: 0.15, rarity: 'rare', mission: 'net-positive', hidden: false },
  { id: 'colorpoint-shorthair', nameEn: 'Colorpoint Shorthair', share: 0.07, rarity: 'rare', mission: 'days-100', hidden: false },
  { id: 'european-burmese', nameEn: 'European Burmese', share: 0.07, rarity: 'rare', mission: 'busy-day', hidden: true },
  { id: 'turkish-van', nameEn: 'Turkish Van', share: 0.07, rarity: 'rare', mission: 'no-spend-10', hidden: true },
  { id: 'korat', nameEn: 'Korat', share: 0.07, rarity: 'rare', mission: 'new-year', hidden: true },
  { id: 'havana-brown', nameEn: 'Havana Brown', share: 0.07, rarity: 'rare', mission: 'christmas', hidden: true },
  { id: 'balinese', nameEn: 'Balinese', share: 0.07, rarity: 'rare', mission: 'meow', hidden: true },
  { id: 'khao-manee', nameEn: 'Khao Manee', share: 0.02, rarity: 'rare', mission: 'lucky-7777', hidden: true },
  { id: 'lykoi', nameEn: 'Lykoi', share: 0.02, rarity: 'rare', mission: 'night-owl', hidden: true },
  { id: 'laperm', nameEn: 'LaPerm', share: 0.02, rarity: 'rare', mission: 'days-365', hidden: true },
  { id: 'burmilla', nameEn: 'Burmilla', share: 0.02, rarity: 'rare', mission: 'collect-20', hidden: true },
  { id: 'american-wirehair', nameEn: 'American Wirehair', share: 0.02, rarity: 'rare', mission: 'parade-5', hidden: true },
  { id: 'toybob', nameEn: 'Toybob', share: 0.02, rarity: 'rare', mission: 'collect-all', hidden: true },
];

export const CAT_BREED_IDS: readonly string[] = CAT_BREEDS.map((breed) => breed.id);

const BREED_BY_ID = new Map(CAT_BREEDS.map((breed) => [breed.id, breed]));

export function catBreedOf(id: string): CatBreedDef | undefined {
  return BREED_BY_ID.get(id);
}

export function isCatBreedId(value: unknown): value is string {
  return typeof value === 'string' && BREED_BY_ID.has(value);
}

/** 화면 아래에 데리고 다니는 고양이의 수 (2026-10-28 사용자 결정). */
export const CAT_PARADE_MAX = 5;

/** 고르지 않았을 때 데리고 다니는 고양이. 먼저 온 차례, 같은 때 왔으면 도감 차례다. */
export function defaultParade(owned: readonly CatDto.Owned[]): string[] {
  const order = new Map(CAT_BREED_IDS.map((id, index) => [id, index]));
  return [...owned]
    .sort(
      (a, b) =>
        a.grantedAt.localeCompare(b.grantedAt) || (order.get(a.breedId) ?? 0) - (order.get(b.breedId) ?? 0),
    )
    .slice(0, CAT_PARADE_MAX)
    .map((cat) => cat.breedId);
}

/** "N종 모으기"의 N. 미션 설명의 숫자와 판정이 이 값을 함께 쓴다. */
export const CAT_COLLECT_GOAL = 20;

/*
 * 표를 고치다 미션을 빠뜨리거나 두 번 쓰면 어느 고양이는 영영 얻을 수 없고 어느 미션은 둘을 준다.
 * 불러올 때 바로 알 수 있게 여기서 확인한다.
 */
if (
  new Set(CAT_BREEDS.map((breed) => breed.mission)).size !== CAT_MISSIONS.length ||
  CAT_BREEDS.length !== CAT_MISSIONS.length
) {
  throw new Error('CAT_BREEDS 와 CAT_MISSIONS 가 한 쌍씩 맞지 않습니다.');
}

export namespace CatDto {
  export interface Owned {
    breedId: string;
    /** ISO 시각. 도감이 "언제 왔는가"를 적는다. */
    grantedAt: string;
  }

  /** GET /cats?projectId= -- 읽을 때 서버가 미션을 다시 판정한 뒤의 모습이다. */
  export interface State {
    owned: Owned[];
    /**
     * 내가 데리고 다니는 고양이. 사람마다 따로다. 얻은 것 중에서만, `CAT_PARADE_MAX` 마리까지.
     *
     * null 이면 아직 한 번도 고르지 않았다 -- 화면은 먼저 온 고양이부터 채워 데리고 다닌다(`defaultParade`).
     * 빈 배열은 "아무도 데리고 다니지 않겠다"는 선택이라 둘을 가른다.
     */
    parade: string[] | null;
  }

  /** PUT /cats/parade?projectId= */
  export interface ParadeRequest {
    breedIds: string[];
  }
}
