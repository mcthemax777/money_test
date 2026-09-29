'use client';

/*
 * 규칙 학습 방법. 알림 원문이 어떻게 앱별 규칙이 되는지를 적은 문서.
 *
 * 아래의 "실제로 돌려 본 예"는 적어 둔 그림이 아니라 이 페이지가 열릴 때 기기와 같은 코드
 * (`@money/core` 의 `notification-rule`)를 돌린 결과다. 코드가 바뀌면 예도 따라 바뀐다.
 * 설명 글은 손으로 적은 것이라, 그 파일의 방법을 바꾸면 여기도 함께 고친다.
 */
import { useMemo } from 'react';
import Link from 'next/link';
import { notificationText, parseNotification } from '@money/core/lib/draft-parse';
import {
  learnRule,
  parseNotificationWithRules,
  sampleParsedOf,
  tokenizeNotification,
} from '@money/core/lib/notification-rule';

import { FIELD_NAME, ParsedTable, SegmentChips, showLiteral } from '../../notification-view';

const PACKAGE = 'com.example.pay';

/**
 * 예로 쓰는 원문. 기존 규칙이 모르는 낱말("쓰셨어요")로 오는 간편결제 알림의 모양이고 값은
 * 지어낸 것이다. 기존 규칙은 이 알림을 금융 알림으로 보지 않는다 -- 앱별 규칙이 메우는 자리다.
 */
const EXAMPLES = [
  { title: '예시페이', text: '스타벅스 성수점에서 4,500원 쓰셨어요\n09/08 14:23 체크카드(1234)' },
  { title: '예시페이', text: 'GS25 역삼에서 12,000원 쓰셨어요\n09/07 09:01 체크카드(1234)' },
  { title: '예시페이', text: '교보문고에서 15,800원 쓰셨어요\n09/06 20:45 체크카드(1234)' },
];
const FRESH = {
  packageName: PACKAGE,
  title: '예시페이',
  text: '원할머니보쌈 강남에서 7,700원 쓰셨어요\n09/08 12:10 체크카드(1234)',
  postedAt: new Date(2026, 8, 8, 12, 30).getTime(),
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2 rounded-xl border border-gray-200 bg-white p-4 text-sm leading-relaxed text-gray-800">
      <h2 className="text-base font-semibold text-gray-900">{title}</h2>
      {children}
    </section>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-gray-100 px-1 py-0.5 font-mono text-xs">{children}</code>;
}

export default function NotificationRuleGuidePage() {
  const example = useMemo(() => {
    const texts = EXAMPLES.map((item) => notificationText(item));
    const steps = texts.map((_, index) => learnRule(texts.slice(0, index + 1))!);
    const learned = steps[steps.length - 1];
    const rule = {
      id: 'example',
      packageName: PACKAGE,
      name: '예시',
      segments: learned.segments,
      // 5번 걸음: "쓰셨어요"는 갈래 낱말이 아니라 짐작이 비어 있고, 사람이 지출로 고른다.
      kind: learned.kind ?? ('expense' as const),
      currency: learned.currency,
      enabled: true,
      note: null,
      learnedFrom: texts.length,
      createdAt: '',
      updatedAt: '',
    };
    return {
      texts,
      tokens: tokenizeNotification(texts[0]),
      steps,
      learned,
      before: sampleParsedOf(parseNotification(FRESH)),
      after: sampleParsedOf(parseNotificationWithRules(FRESH, [rule])),
    };
  }, []);

  return (
    <div className="space-y-5">
      <div>
        <Link href="/admin/notification-rules" className="text-sm text-blue-700 hover:underline">
          ← 알림 규칙
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-gray-900">규칙 학습 방법</h1>
        <p className="mt-1 text-sm text-gray-600">
          알림 원문이 앱별 규칙이 되기까지의 다섯 걸음과, 기기가 그 규칙을 쓰는 방법입니다. 기계 학습 모델은
          쓰지 않습니다. 같은 앱의 원문을 맞대어 늘 같은 글과 바뀌는 칸을 가르는 규칙 셈이고, 칸의 뜻은 사람이
          확인합니다. 코드는 <Code>packages/core/src/lib/notification-rule.ts</Code> 하나입니다.
        </p>
      </div>

      <Section title="1. 원문을 모은다">
        <p>
          기기가 알림을 모을 때(앱이 열릴 때, 알림이 와서 백그라운드 작업이 깰 때) 숫자와 통화 표기(원·₩·USD·$ 등)가
          함께 있는 알림을 서버의 <Code>NotificationSample</Code> 표에 올립니다. <strong>후보가 되지 못한 알림도
          올립니다.</strong> 파서가 놓친 문구를 찾는 것이 원문을 모으는 까닭입니다. 채팅·뉴스처럼 돈 표기가 없는
          알림은 올리지 않습니다.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>담는 것: 앱 이름(packageName), 제목, 본문, 온 시각, 기기 이름, 앱 버전, 그때 기기가 읽은 결과.</li>
          <li>같은 알림은 한 번만 담깁니다(사용자와 알림 열쇠가 유일).</li>
          <li>올리지 못하면(연결 끊김·서버 5xx) 그 알림을 기기 버퍼에 남겨 다음 차례에 다시 올립니다.</li>
          <li>지우는 기한은 없습니다. 원문 화면에서 한 건씩 지울 수 있고, 계정을 지우면 함께 지워집니다.</li>
        </ul>
      </Section>

      <Section title="2. 같은 서식끼리 묶는다">
        <p>
          한 앱이 승인·취소·입금처럼 여러 서식을 보냅니다. 섞어서 맞대면 틀이 칸투성이가 되므로 먼저 묶습니다.
          숫자를 뺀 낱말의 <strong>차례</strong>를 견주어, 두 원문의 공통 부분열 길이가 두 길이 평균의
          75% 이상이면 같은 서식으로 봅니다. 차례를 보지 않고 낱말 모음만 견주면 승인과 승인취소가 같은 낱말을
          대부분 나눠 가져 한 묶음이 됩니다.
        </p>
      </Section>

      <Section title="3. 맞대어 틀을 뽑는다">
        <p>원문을 낱말로 나눕니다. 낱말은 넷입니다.</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>줄바꿈.</strong> 카드 알림은 시각 줄 바로 아래에 가맹점 줄을 둡니다. 줄바꿈을 버리면 두 칸 사이에
            늘 같은 글이 없어 한 칸으로 뭉칩니다.
          </li>
          <li>
            <strong>숫자 덩어리.</strong> 자릿점·날짜·시각 기호를 품습니다(<Code>12,000</Code>, <Code>09/08</Code>,{' '}
            <Code>14:23</Code>). 숫자는 늘 칸이 됩니다. 카드 끝자리처럼 한 사람에게 늘 같은 숫자도 다른 사람에게는
            다릅니다.
          </li>
          <li>
            <strong>글자 덩어리.</strong> 한글 낱말 끝의 토씨(에서·으로·님·을·를 등)는 떼어 냅니다.
            &ldquo;스타벅스에서&rdquo;와 &ldquo;GS25에서&rdquo;를 맞대면 &ldquo;에서&rdquo;가 두 칸을 가르는 글로 남습니다.
          </li>
          <li>
            <strong>기호 하나.</strong> 괄호, 별표 등. 빈칸은 낱말이 아닙니다.
          </li>
        </ul>
        <p>
          첫 원문으로 틀을 만들고(숫자는 칸, 나머지는 글), 다음 원문마다 틀의 글과 원문의 글 사이에서{' '}
          <strong>가장 긴 공통 부분열(LCS)</strong>을 찾습니다. 짝지어진 글은 틀에 남고, 짝과 짝 사이에 어느 한쪽이라도
          남는 것이 있으면 그 자리가 칸이 됩니다. 붙은 칸은 하나로 합칩니다(사이에 글이 없으면 어디서 끊을지 모릅니다).
          모든 원문에 같은 차례로 나오는 글만 끝까지 남습니다.
        </p>
      </Section>

      <Section title="4. 칸의 뜻을 짐작한다">
        <p>칸에 들어온 값과 칸 앞뒤의 글로 짐작합니다. 차례가 곧 우선입니다.</p>
        <ol className="list-decimal space-y-1 pl-5">
          <li>
            <strong>할부</strong> — 값이 &ldquo;일시불&rdquo;·&ldquo;3개월&rdquo;이거나, 숫자 뒤 글이 &ldquo;개월&rdquo;로 시작.
          </li>
          <li>
            <strong>금액</strong> — 숫자이고 앞뒤에 통화 표기가 붙음. 여럿이면 앞 글 열 자 안에 누적·잔액·한도 같은
            낱말이 없는 첫 칸이 금액이고, 나머지는 버림. 통화도 이때 정합니다.
          </li>
          <li>
            <strong>시각</strong> — 값이 날짜·시각 모양이거나, 숫자 뒤 글이 월·일·시·분으로 시작.
          </li>
          <li>
            <strong>카드 끝자리</strong> — 서너 자리 숫자이고 괄호·별표·&ldquo;카드&rdquo; 옆.
          </li>
          <li>
            <strong>가맹점</strong> — 글자가 든 칸 가운데 원문마다 값이 가장 여러 가지인 칸.
          </li>
          <li>나머지는 버림 칸.</li>
        </ol>
        <p>갈래(지출·수입·이체)는 틀에 남은 글의 낱말(승인·입금·이체·취소 등)로 정합니다.</p>
      </Section>

      <Section title="5. 사람이 확인하고 저장한다">
        <ul className="list-disc space-y-1 pl-5">
          <li>칩을 눌러 칸 이름을 고칩니다. 칸마다 원문에서 들어온 값을 보여 줍니다.</li>
          <li>
            원문이 한 건이면 가맹점도 늘 같은 글로 남습니다. 그 글 토막을 눌러 칸으로 바꿉니다(앞뒤가 칸이면 합칩니다).
          </li>
          <li>그 앱의 원문 몇 건을 읽는지, 기존 규칙과 무엇이 다른지를 보고 저장합니다.</li>
          <li>
            서버는 저장할 때 금액 칸이 꼭 하나인지, 칸 둘이 붙지 않았는지, 토막 수(60)·칸 수(12)가 넘지 않는지만 봅니다.
          </li>
        </ul>
      </Section>

      <Section title="기기가 규칙을 쓰는 방법">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            기기는 <Code>GET /notification-rules</Code> 로 켜 둔 규칙을 받아 10분 동안 씁니다. 받지 못하면 마지막으로 받은
            규칙을 씁니다.
          </li>
          <li>
            알림의 앱과 같은 규칙을 만든 차례로 대 보고, <strong>처음 맞고 금액까지 읽힌 규칙</strong>을 씁니다. 규칙이
            비운 칸은 기존 규칙의 값으로 채우고, 맞는 규칙이 없으면 기존 규칙 그대로입니다.
          </li>
          <li>기존 규칙이 금융 알림이 아니라고 본 알림도 규칙이 맞으면 후보가 됩니다.</li>
          <li>
            대 볼 때 빈칸은 보지 않고 줄바꿈은 여럿이어도 하나로 봅니다. 첫 글 토막은 맨 앞에서, 마지막 글 토막은 맨
            끝에서 맞아야 합니다. 정규식을 쓰지 않고 글 토막을 차례로 찾으며, 되짚기는 500번까지입니다.
          </li>
          <li>규칙으로 읽은 후보의 &ldquo;읽은 규칙&rdquo;은 <Code>rule:규칙id</Code> 로 남습니다.</li>
        </ul>
      </Section>

      <Section title="한계">
        <ul className="list-disc space-y-1 pl-5">
          <li>앱이 문구를 바꾸면 규칙이 맞지 않게 됩니다. 알림 원문 화면의 &ldquo;달라진 것만&rdquo;으로 확인합니다.</li>
          <li>줄을 바꾸는 자리가 원문마다 다르면 한 규칙으로 읽지 못합니다. 서식을 나눠 배웁니다.</li>
          <li>두 값 사이에 늘 같은 글이 없으면(줄바꿈도 없으면) 두 값을 한 칸으로밖에 잡지 못합니다.</li>
          <li>안드로이드 15 가 가린 알림(&ldquo;Sensitive notification content hidden&rdquo;)은 돈 표기가 없어 모이지 않습니다.</li>
        </ul>
      </Section>

      <Section title="실제로 돌려 본 예">
        <p className="text-gray-600">이 페이지가 열릴 때 위의 코드를 그대로 돌린 결과입니다. 원문 셋:</p>
        <div className="grid gap-2 sm:grid-cols-3">
          {example.texts.map((text, index) => (
            <p key={index} className="whitespace-pre-wrap rounded bg-gray-50 p-2 font-mono text-xs text-gray-700">
              {text}
            </p>
          ))}
        </div>

        <h3 className="pt-2 font-medium text-gray-900">첫 원문의 낱말</h3>
        <div className="flex flex-wrap gap-1 font-mono text-xs">
          {example.tokens.map((token, index) => (
            <span
              key={index}
              className={`rounded border px-1.5 py-0.5 ${
                token.isNumber ? 'border-blue-200 bg-blue-50 text-blue-800' : 'border-gray-200 bg-white text-gray-700'
              }`}
            >
              {showLiteral(token.text)}
            </span>
          ))}
        </div>
        <p className="text-xs text-gray-500">파란 것이 숫자 덩어리(늘 칸)입니다. ⏎ 는 줄바꿈입니다.</p>

        <h3 className="pt-2 font-medium text-gray-900">맞댈 때마다 바뀌는 틀</h3>
        {example.steps.map((step, index) => (
          <div key={index} className="space-y-1">
            <p className="text-xs text-gray-600">
              원문 {index + 1}건{index === 0 ? ' (숫자만 칸, 가맹점은 아직 글)' : '까지 맞댄 뒤'}
            </p>
            <SegmentChips segments={step.segments} />
          </div>
        ))}

        <h3 className="pt-2 font-medium text-gray-900">짐작한 칸과 들어온 값</h3>
        <ul className="space-y-1 text-xs">
          {example.learned.segments.map((segment, index) =>
            'field' in segment ? (
              <li key={index}>
                <strong>{FIELD_NAME[segment.field]}</strong>: {example.learned.values[index].join(' / ')}
              </li>
            ) : null,
          )}
        </ul>
        <p className="text-xs text-gray-600">
          통화 {example.learned.currency ?? '없음'} · 갈래{' '}
          {example.learned.kind ?? '짐작 못 함 ("쓰셨어요"는 갈래 낱말이 아니다) — 사람이 지출로 골랐다고 두고 읽는다'}
        </p>

        <h3 className="pt-2 font-medium text-gray-900">새 알림을 읽으면</h3>
        <p className="whitespace-pre-wrap rounded bg-gray-50 p-2 font-mono text-xs text-gray-700">
          {notificationText(FRESH)}
        </p>
        <ParsedTable parsed={example.before} compare={example.after} labels={['기존 규칙', '배운 규칙']} />
        <p className="text-xs text-gray-600">
          기존 규칙은 이 알림을 금융 알림으로 보지 않아 아무것도 읽지 못합니다(왼쪽). 배운 규칙은 가맹점 칸 뒤의
          &ldquo;에서&rdquo;, 금액 칸 뒤의 &ldquo;원 쓰셨어요&rdquo;, 끝자리 칸 앞의 &ldquo;체크카드(&rdquo;로 칸을 끊어 읽습니다(오른쪽).
        </p>
      </Section>
    </div>
  );
}
