import * as XLSX from 'xlsx';
import { apiClient } from './api-client';

export async function exportDataToExcel() {
  try {
    // 모든 데이터 병렬로 가져오기
    const [people, accounts, cards, categories, transactions] = await Promise.all([
      apiClient.getPeople(),
      apiClient.getAccountsV2(),
      apiClient.getCards(),
      apiClient.getCategories(),
      apiClient.getTransactionsV2(),
    ]);

    // 워크북 생성
    const workbook = XLSX.utils.book_new();

    // 1. 사용자 시트
    const peopleData = (Array.isArray(people) ? people : people?.data || []).map((p: any) => ({
      ID: p.id,
      이름: p.name,
      생성일: p.createdAt ? new Date(p.createdAt).toLocaleDateString('ko-KR') : '',
      수정일: p.updatedAt ? new Date(p.updatedAt).toLocaleDateString('ko-KR') : '',
    }));
    const peopleSheet = XLSX.utils.json_to_sheet(peopleData);
    XLSX.utils.book_append_sheet(workbook, peopleSheet, '사용자');

    // 2. 계좌 시트
    const accountsData = (Array.isArray(accounts) ? accounts : accounts?.data || []).map((a: any) => ({
      ID: a.id,
      계좌명: a.name,
      은행: a.bankName || '',
      계좌번호: a.accountNumber || '',
      잔액: a.balance || 0,
      생성일: a.createdAt ? new Date(a.createdAt).toLocaleDateString('ko-KR') : '',
    }));
    const accountsSheet = XLSX.utils.json_to_sheet(accountsData);
    XLSX.utils.book_append_sheet(workbook, accountsSheet, '계좌');

    // 3. 카드 시트
    const cardsData = (Array.isArray(cards) ? cards : cards?.data || []).map((c: any) => ({
      ID: c.id,
      카드명: c.name,
      카드사: c.cardCompany || '',
      카드번호: c.cardNumber || '',
      잔액: c.balance || 0,
      생성일: c.createdAt ? new Date(c.createdAt).toLocaleDateString('ko-KR') : '',
    }));
    const cardsSheet = XLSX.utils.json_to_sheet(cardsData);
    XLSX.utils.book_append_sheet(workbook, cardsSheet, '카드');

    // 4. 카테고리 시트
    const categoriesData = (Array.isArray(categories) ? categories : categories?.data || []).map((c: any) => ({
      ID: c.id,
      카테고리명: c.name,
      유형: c.type || '수입',
      색상: c.color || '',
      생성일: c.createdAt ? new Date(c.createdAt).toLocaleDateString('ko-KR') : '',
    }));
    const categoriesSheet = XLSX.utils.json_to_sheet(categoriesData);
    XLSX.utils.book_append_sheet(workbook, categoriesSheet, '카테고리');

    // 5. 거래내역 시트
    const transactionsData = (Array.isArray(transactions) ? transactions : transactions?.data || []).map(
      (t: any) => ({
        ID: t.id,
        금액: t.amount || 0,
        설명: t.description || '',
        카테고리: t.categoryId || '',
        계좌: t.accountId || '',
        카드: t.cardId || '',
        거래일자: t.transactionDate ? new Date(t.transactionDate).toLocaleDateString('ko-KR') : '',
        생성일: t.createdAt ? new Date(t.createdAt).toLocaleDateString('ko-KR') : '',
      }),
    );
    const transactionsSheet = XLSX.utils.json_to_sheet(transactionsData);
    XLSX.utils.book_append_sheet(workbook, transactionsSheet, '거래내역');

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

      sheet['!cols'] = colWidths.map((width) => ({ wch: Math.min(width, 30) }));
    };

    [peopleSheet, accountsSheet, cardsSheet, categoriesSheet, transactionsSheet].forEach(adjustColWidth);

    // 파일 다운로드
    const fileName = `MoneyApp_${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(workbook, fileName);

    return { success: true, fileName };
  } catch (error) {
    console.error('엑셀 내보내기 실패:', error);
    throw error;
  }
}
