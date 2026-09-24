'use client';

import { useTranslation } from '@money/core/lib/i18n';

/**
 * 알림·캡처에서 이 통장·카드를 알아보는 말.
 *
 * 보관함이 문구를 읽어 후보를 만들 때 가장 먼저 보는 단서다(`draft-match`). 끝 네 자리도
 * 카드 이름도 적히지 않는 알림이 있고, 같은 카드사 카드가 둘이면 기기는 어느 것인지 알
 * 수 없다 -- 그 글에 늘 함께 오는 말을 사람이 한 번 적어 두면 그 뒤로는 저절로 채워진다.
 *
 * 여러 줄을 받는다. 한 수단에 붙는 알림이 여러 모양인 일이 흔하다(승인·취소·해외).
 * 통장과 카드가 같은 칸을 쓰므로 네 곳(통장 추가·수정, 카드 추가·수정)이 이 판 하나를
 * 나눠 쓴다. 앱에도 같은 칸이 있다.
 */
export default function MatchTextField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-700">{t('match.label')}</label>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={2}
        placeholder={t('match.placeholder')}
        /*
          줄바꿈이 뜻을 갖는 칸이라 여러 줄을 받는다. 크기 조절은 세로만 열어 둔다 --
          가로로 늘리면 모달 밖으로 나간다.
        */
        className="w-full resize-y rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <p className="mt-1 text-xs text-gray-500">{t('match.hint')}</p>
    </div>
  );
}
