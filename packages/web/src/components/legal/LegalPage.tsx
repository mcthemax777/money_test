/*
 * 개인정보처리방침·이용약관·계정 삭제 안내의 공통 틀 (2026-10-25).
 *
 * 로그인 없이 열린다. 스토어 심사와 처음 쓰는 사람이 가입 전에 읽어야 하기 때문이다. 내용은 페이지마다
 * 절(section) 목록으로 적고, 이 틀은 제목·시행일·운영자 정보 자리와 절을 그린다.
 */
import Link from 'next/link';

export interface LegalSection {
  title: string;
  /** 문단. 배열의 원소 하나가 한 문단이다. 목록이 필요하면 `items` 를 쓴다. */
  body?: string[];
  items?: string[];
}

/**
 * 운영자 정보. **출시 전에 운영자가 채운다** -- 비어 있는 동안에는 화면에 "확인 중"으로 보인다.
 * 전자상거래법 §10 의 표시 사항(상호, 대표자, 주소, 연락처, 사업자등록번호, 통신판매업 신고번호)과
 * 개인정보 보호책임자다.
 */
export const OPERATOR = {
  name: '',
  representative: '',
  address: '',
  email: '',
  businessNumber: '',
  mailOrderNumber: '',
  privacyOfficer: '',
};

const pending = '확인 중';

export function operatorLine(): string {
  return [
    `상호 ${OPERATOR.name || pending}`,
    `대표자 ${OPERATOR.representative || pending}`,
    `사업자등록번호 ${OPERATOR.businessNumber || pending}`,
    `통신판매업 신고번호 ${OPERATOR.mailOrderNumber || pending}`,
    `주소 ${OPERATOR.address || pending}`,
    `문의 ${OPERATOR.email || pending}`,
  ].join(' · ');
}

export default function LegalPage({
  title,
  effectiveDate,
  intro,
  sections,
}: {
  title: string;
  /** 시행일 "YYYY-MM-DD". */
  effectiveDate: string;
  intro?: string;
  sections: LegalSection[];
}) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 text-gray-800">
      <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
      <p className="mt-2 text-sm text-gray-500">시행일 {effectiveDate}</p>
      {intro ? <p className="mt-6 leading-7">{intro}</p> : null}

      {sections.map((section, index) => (
        <section key={section.title} className="mt-8">
          <h2 className="text-lg font-semibold text-gray-900">
            {index + 1}. {section.title}
          </h2>
          {section.body?.map((paragraph) => (
            <p key={paragraph} className="mt-3 leading-7">
              {paragraph}
            </p>
          ))}
          {section.items ? (
            <ul className="mt-3 list-disc space-y-1 pl-5 leading-7">
              {section.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ))}

      <footer className="mt-12 border-t border-gray-200 pt-6 text-xs leading-6 text-gray-500">
        <p>{operatorLine()}</p>
        <p className="mt-2 space-x-3">
          <Link href="/privacy" className="underline">
            개인정보처리방침
          </Link>
          <Link href="/terms" className="underline">
            이용약관
          </Link>
          <Link href="/account-deletion" className="underline">
            계정 삭제 안내
          </Link>
        </p>
      </footer>
    </main>
  );
}
