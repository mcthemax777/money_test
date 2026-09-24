/**
 * 초대 번호와 그것을 담은 QR.
 *
 * 가계부에 사람을 들이는 길은 둘이다. **번호를 불러 주거나 QR 을 보여 주거나.** 둘 다
 * 같은 값을 가리키므로(초대 번호) 만드는 규칙과 읽는 규칙을 여기 한 곳에 둔다 -- 웹이
 * 만든 QR 을 앱이 찍고, 앱이 만든 QR 을 웹에서 연다.
 *
 * QR 에는 **링크**를 담는다. 번호만 담으면 기기의 기본 카메라로 찍었을 때 아무 데도
 * 가지 못하고 글자만 뜬다. 링크면 그 자리에서 가계부가 열리고, 우리 앱의 스캐너는
 * 링크에서 번호만 떼어 쓴다.
 */
import qrcode from 'qrcode-generator';

/** 초대를 여는 웹 주소. 앱의 스캐너와 웹의 `/join` 이 같은 모양을 읽는다. */
export function inviteUrlOf(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, '')}/join?code=${encodeURIComponent(code)}`;
}

/**
 * 찍거나 붙여 넣은 글에서 초대 번호만 떼어 낸다.
 *
 * 세 가지가 들어온다 -- 링크(`https://…/join?code=ABCD1234`), 번호만(`ABCD1234`),
 * 그리고 사람이 붙임표를 섞어 적은 것(`ABCD-1234`). 어느 쪽이든 번호로 만든다.
 *
 * 대문자로 올리지 않는다. 옛 번호는 32 자 소문자 16진수이고, 서버가 두 모양을 모두
 * 받는다 (`ProjectsService.findInvitation`).
 */
export function inviteCodeOf(scanned: string): string {
  const text = (scanned ?? '').trim();
  if (!text) return '';

  const fromQuery = /[?&]code=([^&\s]+)/.exec(text);
  const code = fromQuery ? decodeURIComponent(fromQuery[1]) : text;

  // 링크가 아닌데 주소처럼 생겼으면 번호가 아니다. 빈 값으로 두고 화면이 다시 묻는다.
  if (!fromQuery && /[/:?#]/.test(code)) return '';

  return code.replace(/[\s-]/g, '');
}

/**
 * QR 한 판. `true` 인 칸이 검다.
 *
 * 그리는 일은 화면이 맡는다 -- 웹은 SVG 사각형, 앱은 react-native-svg 다. 여기서
 * 이미지를 만들지 않는 것은 두 플랫폼이 이미지를 다루는 방법이 다르고, 칸만 있으면
 * 어느 쪽에서든 원하는 크기로 또렷하게 그릴 수 있기 때문이다.
 *
 * 오류 정정은 M 이다. 화면에 띄워 바로 찍는 QR 이라 L 로도 되지만, 밝기를 낮춘 폰
 * 화면이나 지문 자국에서 M 쪽이 눈에 띄게 잘 읽힌다. 판 크기(typeNumber)는 0 으로
 * 두어 글의 길이에 맞게 저절로 정해진다.
 */
export function qrMatrix(text: string): boolean[][] {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();

  const count = qr.getModuleCount();
  const rows: boolean[][] = [];
  for (let row = 0; row < count; row += 1) {
    const cells: boolean[] = [];
    for (let column = 0; column < count; column += 1) {
      cells.push(qr.isDark(row, column));
    }
    rows.push(cells);
  }
  return rows;
}
