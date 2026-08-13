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

    // 배열 정규화
    const peopleArray = Array.isArray(people) ? people : people?.data || [];
    const accountsArray = Array.isArray(accounts) ? accounts : accounts?.data || [];
    const cardsArray = Array.isArray(cards) ? cards : cards?.data || [];
    const categoriesArray = Array.isArray(categories) ? categories : categories?.data || [];
    const transactionsArray = Array.isArray(transactions) ? transactions : transactions?.data || [];

    // 조회 맵 생성 (빠른 검색용)
    const peopleMap = new Map(peopleArray.map((p: any) => [p.id, p.name]));
    const accountsMap = new Map(accountsArray.map((a: any) => [a.id, a]));
    const cardsMap = new Map(cardsArray.map((c: any) => [c.id, c]));
    const categoriesMap = new Map(categoriesArray.map((c: any) => [c.id, c]));

    // 워크북 생성
    const workbook = XLSX.utils.book_new();

    // 1. 사용자 시트
    const peopleData = peopleArray.map((p: any) => ({
      ID: p.id,
      이름: p.name,
      생성일: p.createdAt ? new Date(p.createdAt).toLocaleDateString('ko-KR') : '',
      수정일: p.updatedAt ? new Date(p.updatedAt).toLocaleDateString('ko-KR') : '',
    }));
    const peopleSheet = XLSX.utils.json_to_sheet(peopleData);
    XLSX.utils.book_append_sheet(workbook, peopleSheet, '사용자');

    // 2. 계좌 시트
    const accountsData = accountsArray.map((a: any) => ({
      ID: a.id,
      계좌명: a.name,
      사용자명: a.ownerId ? peopleMap.get(a.ownerId) || '-' : '-',
      은행: a.bankName || '',
      계좌번호: a.accountNumber || '',
      잔액: a.balance || 0,
      생성일: a.createdAt ? new Date(a.createdAt).toLocaleDateString('ko-KR') : '',
    }));
    const accountsSheet = XLSX.utils.json_to_sheet(accountsData);
    XLSX.utils.book_append_sheet(workbook, accountsSheet, '계좌');

    // 3. 카드 시트
    const cardsData = cardsArray.map((c: any) => {
      const account = c.accountId ? accountsMap.get(c.accountId) as any : null;
      return {
        ID: c.id,
        카드명: c.name,
        계좌명: account?.name || '-',
        계좌사용자명: account?.ownerId ? peopleMap.get(account.ownerId) || '-' : '-',
        카드사: c.cardCompany || c.issuer || '',
        카드번호: c.cardNumber || '',
        잔액: c.balance || 0,
        생성일: c.createdAt ? new Date(c.createdAt).toLocaleDateString('ko-KR') : '',
      };
    });
    const cardsSheet = XLSX.utils.json_to_sheet(cardsData);
    XLSX.utils.book_append_sheet(workbook, cardsSheet, '카드');

    // 4. 카테고리 시트
    const categoriesData = categoriesArray.map((c: any) => {
      const parent = c.parentId ? categoriesMap.get(c.parentId) as any : null;
      return {
        ID: c.id,
        카테고리명: c.name,
        유형: c.type === 'income' ? '수입' : c.type === 'expense' ? '지출' : c.type,
        대분류: parent?.name || '-',
        소분류: c.level === 2 ? c.name : '-',
        색상: c.color || '',
        생성일: c.createdAt ? new Date(c.createdAt).toLocaleDateString('ko-KR') : '',
      };
    });
    const categoriesSheet = XLSX.utils.json_to_sheet(categoriesData);
    XLSX.utils.book_append_sheet(workbook, categoriesSheet, '카테고리');

    // 5. 거래내역 시트
    const transactionsData = transactionsArray.map((t: any) => {
      const account = t.accountId ? accountsMap.get(t.accountId) as any : null;
      const card = t.cardId ? cardsMap.get(t.cardId) as any : null;
      const mainCat = t.mainCategoryId ? categoriesMap.get(t.mainCategoryId) as any : null;
      const subCat = t.subCategoryId ? categoriesMap.get(t.subCategoryId) as any : null;

      return {
        ID: t.id,
        금액: t.amount || 0,
        유형: t.type === 'income' ? '수입' : t.type === 'expense' ? '지출' : t.type || '기타',
        대분류: mainCat?.name || t.mainCategory || '-',
        소분류: subCat?.name || t.subCategory || '-',
        설명: t.description || '',
        거래자: t.personId ? peopleMap.get(t.personId) || '-' : '-',
        계좌: account?.name || '-',
        카드: card?.name || '-',
        거래일자: t.transactionDate
          ? new Date(t.transactionDate).toLocaleDateString('ko-KR')
          : t.date
            ? new Date(t.date).toLocaleDateString('ko-KR')
            : '',
        생성일: t.createdAt ? new Date(t.createdAt).toLocaleDateString('ko-KR') : '',
      };
    });
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

      sheet['!cols'] = colWidths.map((width) => ({ wch: Math.min(width, 35) }));
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
