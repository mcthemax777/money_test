/**
 * API 클라이언트가 내보내는 응답·요청 모양 가운데 `@money/types` 에 없는 것.
 * 바깥에서는 `api-client` 로 가져다 쓴다.
 */

import type { ExchangeRateInfo } from '@money/types';

/**
 * 리포트가 볼 구간.
 *
 * 한 달이거나 임의 구간이다. 달력의 달과 어긋나는 구간(카드 청구주기, 여행 기간)을
 * 보는 일이 있어서 둘 다 받는다. 날짜는 프로젝트 타임존의 달력 날짜이고 양끝을 포함한다.
 */
export type ReportPeriod =
  | { yearMonth: string; startDate?: undefined; endDate?: undefined }
  | { startDate: string; endDate: string; yearMonth?: undefined };

/**
 * 환율 응답.
 *
 * rates 는 각 통화 -> 저장 통화다. 거래를 입력할 때 쓴다.
 * displayRate 는 저장 통화 -> 표시 통화이며 화면 합계에 이미 반영돼 온다.
 */
export interface ExchangeRatesResponse {
  ledgerCurrency: string;
  displayCurrency: string;
  rates: ExchangeRateInfo[];
  displayRate: ExchangeRateInfo;
}
