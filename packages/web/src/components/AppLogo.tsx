/**
 * 앱 표시. 파란 모서리 둥근 바탕에 흰 지갑이다.
 *
 * 작게 그려도 알아볼 수 있도록 도형을 넷으로 줄였다. 24px 자리에서 가는 선은
 * 뭉개져 무엇인지 알 수 없게 된다. 파랑은 화면 곳곳에서 쓰는 강조색과 같은
 * 값(tailwind blue-600)이라 로고만 따로 노는 색이 되지 않는다.
 *
 * 이름표(“bboyong”)가 늘 옆에 붙으므로 그림 자체는 읽어 줄 것이 없다(aria-hidden).
 */
export default function AppLogo({ className = 'h-6 w-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`${className} shrink-0`} aria-hidden focusable="false">
      <rect x="1" y="1" width="22" height="22" rx="6.5" fill="#2563eb" />
      {/* 지갑 몸통 */}
      <rect x="4.5" y="7.5" width="15" height="10" rx="2.5" fill="#ffffff" />
      {/* 카드 넣는 자리. 오른쪽 끝에 붙여 지갑처럼 보이게 한다. */}
      <rect x="13" y="11" width="6.5" height="3" rx="1.5" fill="#bfdbfe" />
      <circle cx="15.75" cy="12.5" r="0.9" fill="#2563eb" />
    </svg>
  );
}

/**
 * 로고와 앱 이름을 나란히.
 *
 * 좁은 화면의 위쪽 막대와 넓은 화면의 사이드바가 함께 쓴다. 이름을 두 곳에 적어
 * 두면 앱 이름을 바꿀 때 한쪽만 고쳐진다.
 */
export function AppBrand({ size = 'sm' }: { size?: 'sm' | 'md' }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <AppLogo className={size === 'md' ? 'h-7 w-7' : 'h-6 w-6'} />
      <span className={`font-semibold text-gray-900 ${size === 'md' ? 'text-base' : 'text-sm'}`}>
        bboyong
      </span>
    </span>
  );
}
