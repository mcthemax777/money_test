import * as XLSX from 'xlsx';
import { DEFAULT_TIME_ZONE } from '@money/types';
import { apiClient } from './api-client';
import { formatDate } from './datetime';
import { toNumber } from './money';
import { ACCOUNT_TYPE_LABEL } from './account-type';

const ENTRY_KIND_LABEL: Record<string, string> = {
  expense: '지출',
  income: '수입',
  transfer: '이체',
  card_payment: '카드대금',
  adjustment: '잔액조정',
};

/**
 * 전체 데이터를 엑셀로 내보낸다.
 *
 * 거래일자는 프로젝트 기준 타임존으로 표기한다. 브라우저 로컬로 읽으면
 * 화면에 보이던 날짜와 파일 안의 날짜가 어긋난다.
 */
export async function exportDataToExcel(
  timeZone: string = DEFAULT_TIME_ZONE,
  displayCurrency: string = 'KRW',
) {
  try {
    // 모든 데이터 병렬로 가져오기
    // 거래는 커서를 따라 전부 받는다 (내보내기는 전량이 필요하다)
    const [people, accounts, cards, categories, entries] = await Promise.all([
      apiClient.getPeople(),
      apiClient.getAccountsV2(),
      apiClient.getCards(),
      apiClient.getCategories(),
      apiClient.getAllEntries(),
    ]);

    // 배열 정규화
    // API는 배열을 그대로 준다. 감싸는 래퍼가 없다.
    const peopleArray = people ?? [];
    const accountsArray = accounts ?? [];
    const cardsArray = cards ?? [];
    const categoriesArray = categories ?? [];
    const entriesArray = entries ?? [];

    // 조회 맵 생성 (빠른 검색용)
    const peopleMap = new Map(peopleArray.map((p: any) => [p.id, p.name]));
    const accountsMap = new Map(accountsArray.map((a: any) => [a.id, a]));
    const categoriesMap = new Map(categoriesArray.map((c: any) => [c.id, c]));

    // 워크북 생성
    const workbook = XLSX.utils.book_new();

    // 1. 사용자 시트
    const peopleData = peopleArray.map((p: any) => ({
      이름: p.name,
      생성일: p.createdAt ? formatDate(p.createdAt, timeZone) : '',
      수정일: p.updatedAt ? formatDate(p.updatedAt, timeZone) : '',
    }));
    const peopleSheet = XLSX.utils.json_to_sheet(peopleData);
    XLSX.utils.book_append_sheet(workbook, peopleSheet, '사용자');

    // 2. 계좌 시트
    const accountsData = accountsArray.map((a: any) => ({
      계좌명: a.name,
      사용자명: a.ownerId ? peopleMap.get(a.ownerId) || '' : '-',
      은행: a.institution?.name || '',
      유형: ACCOUNT_TYPE_LABEL[a.type] || a.type || '',
      계좌번호: a.accountNumber || '',
      // 잔액은 그 계좌의 통화다. 통화 열이 없으면 달러 통장과 원화 통장의 숫자를
      // 그대로 더하게 된다.
      통화: a.currency || displayCurrency,
      잔액: toNumber(a.balance),
      생성일: a.createdAt ? formatDate(a.createdAt, timeZone) : '',
    }));
    const accountsSheet = XLSX.utils.json_to_sheet(accountsData);
    XLSX.utils.book_append_sheet(workbook, accountsSheet, '계좌');

    // 3. 카드 시트
    const cardsData = cardsArray.map((c: any) => {
      const account = c.paymentAccountId ? (accountsMap.get(c.paymentAccountId) as any) : null;
      return {
        카드명: c.name,
        종류: c.cardType === 'credit' ? '신용' : '체크',
        결제통장: account?.name || '',
        카드사: c.issuer?.name || '',
        카드번호: c.cardNumberMasked || '',
        // 사용액은 결제 통장의 통화다.
        통화: account?.currency || displayCurrency,
        // 신용카드 사용액. 체크카드는 빚이 생기지 않으므로 0
        사용액: toNumber(c.currentUsage),
        생성일: c.createdAt ? formatDate(c.createdAt, timeZone) : '',
      };
    });
    const cardsSheet = XLSX.utils.json_to_sheet(cardsData);
    XLSX.utils.book_append_sheet(workbook, cardsSheet, '카드');

    // 4. 카테고리 시트
    const categoriesData = categoriesArray.map((c: any) => {
      const parent = c.parentId ? categoriesMap.get(c.parentId) as any : null;
      return {
        카테고리명: c.name,
        유형: c.type === 'income' ? '수입' : c.type === 'expense' ? '지출' : c.type,
        상위분류: parent?.name || '',
        생성일: c.createdAt ? formatDate(c.createdAt, timeZone) : '',
      };
    });
    const categoriesSheet = XLSX.utils.json_to_sheet(categoriesData);
    XLSX.utils.book_append_sheet(workbook, categoriesSheet, '카테고리');

    // 5. 거래내역 시트
    //
    // 서버가 전표를 한 줄로 펴서 주므로(EntryListItem) 여기서 postings를 다루지 않는다.
    const entriesData = entriesArray.map((e: any) => ({
      // 거래 금액은 언제나 기준통화 환산액이다. 원 통화 금액은 옆 열에 따로 둔다.
      금액: toNumber(e.amount),
      통화: displayCurrency,
      '원 통화': e.originalCurrency || '',
      '원 통화 금액': e.originalAmount ? toNumber(e.originalAmount) : '',
      환율: e.exchangeRate ? toNumber(e.exchangeRate) : '',
      유형: ENTRY_KIND_LABEL[e.kind] || e.kind || '기타',
      거래자: e.personName || '',
      대분류: e.parentCategoryName || e.categoryName || '',
      // 소분류가 있을 때만 채운다 (대분류만 지정한 거래는 비워 둔다)
      소분류: e.parentCategoryName ? e.categoryName || '' : '',
      고정: e.isFixed ? 'Y' : '',
      설명: e.description || '',
      거래처: e.merchant || '',
      상세설명: e.detailedNote || '',
      계좌: e.accountName || '',
      대상계좌: e.toAccountName || '',
      카드: e.cardName || '',
      거래일자: e.date ? formatDate(e.date, timeZone) : '',
    }));
    const entriesSheet = XLSX.utils.json_to_sheet(entriesData);
    XLSX.utils.book_append_sheet(workbook, entriesSheet, '거래내역');

    // 열 너비 자동 조정
    const adjustColWidth = (sheet: XLSX.WorkSheet) => {
      const colWidths: number[] = [];
      const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

      aoa.forEach((row) => {
        row.forEach((cell, idx) => {
          const cellLength = (cell?.toString() || '').length;
          colWidths[idx] = Math.max(colWidths[idx] || 0, cellLength + 2);
        });
      });

      sheet['!cols'] = colWidths.map((width) => ({ wch: Math.min(width, 35) }));
    };

    [peopleSheet, accountsSheet, cardsSheet, categoriesSheet, entriesSheet].forEach(adjustColWidth);

    // 파일 다운로드
    const fileName = `bboyong_${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(workbook, fileName);

    return { success: true, fileName };
  } catch (error) {
    console.error('엑셀 내보내기 실패:', error);
    throw error;
  }
}
