/**
 * 화면이 쓰는 서버 응답 타입.
 *
 * 여기서 다시 선언하지 않고 `@money/types`의 DTO를 그대로 내보낸다.
 * 예전에는 파일마다 `interface Card`를 따로 선언했고, 스키마가 바뀌어도
 * 그 선언들은 그대로 남아 조용히 어긋났다. 정의는 서버와 공유하는 한 곳에만 둔다.
 *
 * 엔티티가 아니라 DTO를 쓰는 이유: 서버가 내보내는 모양이 엔티티와 다르다.
 * 예를 들어 카드는 실제 번호 대신 마스킹된 번호와 사용액을 준다.
 */
import type {
  AccountDto,
  CardDto,
  CategoryDto,
  InstitutionDto,
  PersonDto,
  StatementDto,
} from '@money/types';

export type Account = AccountDto.Response;
/** 은행/카드사. isCustom이 false면 기본 제공 항목 */
export type Institution = InstitutionDto.Response;
export type Card = CardDto.Response;
export type Category = CategoryDto.Response;
export type Person = PersonDto.Response;
/** 청구서. 미결제액이 계산되어 온다 */
export type Statement = StatementDto.Response;
/** 계좌 원장 한 줄 (거래별 잔액 추이 포함) */
export type LedgerRow = AccountDto.LedgerRow;

export type {
  AccountType,
  CardType,
  CategoryType,
  FinancialInstitutionType,
  EntryKind,
  EntryListItem,
  Project,
  ProjectMember,
  ProjectRole,
  StatementStatus,
  User,
} from '@money/types';
