import * as XLSX from 'xlsx';
import { apiClient } from './api-client';

interface ImportResult {
  success: boolean;
  projectId?: string;
  projectName?: string;
  summary: {
    people: number;
    accounts: number;
    cards: number;
    categories: number;
    transactions: number;
  };
  errors: string[];
}

interface NameMapping {
  people: Map<string, any>;
  accounts: Map<string, any>;
  cards: Map<string, any>;
  categories: Map<string, any>;
}

export async function importDataFromExcel(file: File, projectName: string): Promise<ImportResult> {
  const result: ImportResult = {
    success: true,
    summary: {
      people: 0,
      accounts: 0,
      cards: 0,
      categories: 0,
      transactions: 0,
    },
    errors: [],
  };

  const nameMapping: NameMapping = {
    people: new Map(),
    accounts: new Map(),
    cards: new Map(),
    categories: new Map(),
  };

  try {
    // 새 프로젝트 생성
    const projectResponse = await apiClient.createProject(projectName);
    const projectId = projectResponse.data?.id || projectResponse.id;
    if (!projectId) {
      throw new Error('프로젝트 생성 실패');
    }
    result.projectId = projectId;
    result.projectName = projectName;

    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });

    // 1. 사용자 데이터 임포트
    const peopleSheet = workbook.Sheets['사용자'];
    if (peopleSheet) {
      const peopleData = XLSX.utils.sheet_to_json(peopleSheet);
      for (const row of peopleData) {
        const anyRow = row as any;
        try {
          const response = await apiClient.createPerson({
            name: anyRow['이름'],
            projectId,
          });
          const newPerson = response.data || response;
          nameMapping.people.set(anyRow['이름'], newPerson);
          result.summary.people++;
        } catch (error) {
          result.errors.push(`사용자 "${anyRow['이름']}" 생성 실패: ${error}`);
          result.success = false;
        }
      }
    }

    // 2. 계좌 데이터 임포트
    const accountsSheet = workbook.Sheets['계좌'];
    if (accountsSheet) {
      const accountsData = XLSX.utils.sheet_to_json(accountsSheet);
      for (const row of accountsData) {
        const anyRow = row as any;
        try {
          const ownerName = anyRow['사용자명'];
          const ownerId = ownerName && ownerName?.trim() ? nameMapping.people.get(ownerName)?.id : undefined;

          const response = await apiClient.createAccountV2({
            name: anyRow['계좌명'],
            ownerId,
            bankName: anyRow['은행'] || '',
            accountNumber: anyRow['계좌번호'] || '',
            balance: anyRow['잔액'] || 0,
            projectId,
          });
          const newAccount = response.data || response;
          nameMapping.accounts.set(anyRow['계좌명'], newAccount);
          result.summary.accounts++;
        } catch (error) {
          result.errors.push(`계좌 "${anyRow['계좌명']}" 생성 실패: ${error}`);
          result.success = false;
        }
      }
    }

    // 3. 카드 데이터 임포트
    const cardsSheet = workbook.Sheets['카드'];
    if (cardsSheet) {
      const cardsData = XLSX.utils.sheet_to_json(cardsSheet);
      for (const row of cardsData) {
        const anyRow = row as any;
        try {
          const accountName = anyRow['계좌명'];
          const accountId = accountName ? nameMapping.accounts.get(accountName)?.id : undefined;

          const response = await apiClient.createCard({
            name: anyRow['카드명'],
            accountId,
            issuer: anyRow['카드사'] || '',
            cardNumber: anyRow['카드번호'] || '',
            balance: anyRow['잔액'] || 0,
            projectId,
          });
          const newCard = response.data || response;
          nameMapping.cards.set(anyRow['카드명'], newCard);
          result.summary.cards++;
        } catch (error) {
          result.errors.push(`카드 "${anyRow['카드명']}" 생성 실패: ${error}`);
          result.success = false;
        }
      }
    }

    // 4. 카테고리 데이터 임포트 (부모 카테고리부터 처리)
    const categoriesSheet = workbook.Sheets['카테고리'];
    if (categoriesSheet) {
      const categoriesData = XLSX.utils.sheet_to_json(categoriesSheet) as any[];

      // 기존 카테고리 미리 로드 (기본 카테고리들이 자동으로 생성됨)
      const existingCategoriesResponse = await apiClient.getCategories(projectId);
      const existingCategories = (existingCategoriesResponse.data || existingCategoriesResponse);
      if (Array.isArray(existingCategories)) {
        existingCategories.forEach((cat: any) => {
          nameMapping.categories.set(cat.name, cat);
        });
      }

      // 상위분류가 비어있는 것(부모)부터 처리
      const rootCategories = categoriesData.filter((c) => !c['상위분류']);
      const childCategories = categoriesData.filter((c) => c['상위분류']);

      const processCategory = async (row: any) => {
        try {
          const categoryName = row['카테고리명'];

          // 이미 존재하는 카테고리면 건너뛰기
          if (nameMapping.categories.has(categoryName)) {
            result.summary.categories++;
            return;
          }

          const parentName = row['상위분류'];
          const parentId = parentName ? nameMapping.categories.get(parentName)?.id : undefined;

          const typeMap: Record<string, string> = {
            '수입': 'income',
            '지출': 'expense',
          };

          const response = await apiClient.createCategory({
            name: categoryName,
            type: typeMap[row['유형']] || row['유형'],
            parentId,
            projectId,
          });
          const newCategory = response.data || response;
          nameMapping.categories.set(categoryName, newCategory);
          result.summary.categories++;
        } catch (error) {
          result.errors.push(`카테고리 "${row['카테고리명']}" 생성 실패: ${error}`);
          result.success = false;
        }
      };

      for (const category of rootCategories) {
        await processCategory(category);
      }

      for (const category of childCategories) {
        await processCategory(category);
      }
    }

    // 5. 거래내역 데이터 임포트
    const transactionsSheet = workbook.Sheets['거래내역'];
    if (transactionsSheet) {
      const transactionsData = XLSX.utils.sheet_to_json(transactionsSheet);
      for (const row of transactionsData) {
        const anyRow = row as any;
        try {
          const personName = anyRow['거래자'];
          const personId = personName ? nameMapping.people.get(personName)?.id : undefined;

          const accountName = anyRow['계좌'];
          const accountId = accountName ? nameMapping.accounts.get(accountName)?.id : undefined;

          const cardName = anyRow['카드'];
          const cardId = cardName ? nameMapping.cards.get(cardName)?.id : undefined;

          const mainCatName = anyRow['대분류'];
          const subCatName = anyRow['소분류'];

          const mainCategoryId = mainCatName ? nameMapping.categories.get(mainCatName)?.id : undefined;
          const subCategoryId = subCatName ? nameMapping.categories.get(subCatName)?.id : undefined;

          const typeMap: Record<string, string> = {
            '수입': 'income',
            '지출': 'expense',
            '기타': 'other',
          };

          let transactionDate = new Date().toISOString().split('T')[0];
          if (anyRow['거래일자']) {
            const dateValue = anyRow['거래일자'];
            let date: Date | null = null;

            // Handle Excel serial date (number or numeric string) or string date
            if (typeof dateValue === 'number') {
              // Excel date: days since 1900-01-01 (with 1900 leap year bug)
              const excelEpoch = new Date(1900, 0, 1);
              date = new Date(excelEpoch.getTime() + (dateValue - 1) * 86400000);
            } else if (typeof dateValue === 'string') {
              // Check if it's a numeric string (Excel 일련번호)
              const numValue = parseInt(dateValue);
              if (!isNaN(numValue) && String(numValue) === String(dateValue).trim()) {
                // Numeric string - treat as Excel serial date
                const excelEpoch = new Date(1900, 0, 1);
                date = new Date(excelEpoch.getTime() + (numValue - 1) * 86400000);
              } else {
                // Try parsing Korean date format (YYYY. M. D. or YYYY. M. D or YYYY.M.D)
                const koreanMatch = dateValue.match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\s*\.?/);
                if (koreanMatch) {
                  const [, year, month, day] = koreanMatch;
                  // ISO 형식으로 직접 생성 (시간대 문제 방지)
                  const isoDate = `${year}-${String(parseInt(month)).padStart(2, '0')}-${String(parseInt(day)).padStart(2, '0')}`;
                  transactionDate = isoDate;
                } else {
                  // Try standard date format
                  date = new Date(dateValue);
                }
              }
            }

            if (date && !isNaN(date.getTime())) {
              transactionDate = date.toISOString().split('T')[0];
            }
          }

          const response = await apiClient.createTransactionV2({
            amount: anyRow['금액'],
            type: typeMap[anyRow['유형']] || anyRow['유형'],
            personId,
            accountId,
            cardId,
            mainCategoryId,
            subCategoryId,
            description: anyRow['설명'] || '',
            transactionDate,
            projectId,
          });
          result.summary.transactions++;
        } catch (error) {
          result.errors.push(`거래내역 (금액: ${anyRow['금액']}) 생성 실패: ${error}`);
          result.success = false;
        }
      }
    }

    return result;
  } catch (error) {
    console.error('엑셀 임포트 실패:', error);
    result.success = false;
    result.errors.push(`파일 처리 실패: ${error}`);
    return result;
  }
}
