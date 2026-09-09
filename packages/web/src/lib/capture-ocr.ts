/**
 * 브라우저에서 사진의 글자를 읽는다.
 *
 * 앱은 기기 OCR(ML Kit)을 쓴다. 웹에는 그것이 없으므로 **브라우저 안에서** 도는
 * tesseract.js(WASM)를 쓴다. 두 길의 성질을 같게 두는 것이 요점이다 -- 사진은
 * 어느 쪽에서도 서버로 가지 않고, 읽어 낸 글자만 core 의 같은 규칙(`draft-parse`)을
 * 지난다.
 *
 * **읽는 자료는 처음 한 번 내려온다.** 한국어 모델(약 10MB)과 WASM 을 tesseract.js
 * 기본 경로(CDN)에서 받아 브라우저에 캐시한다. 그래서 첫 인식은 느리고 그다음은
 * 빠르다. 내려오는 것은 모델이고, 올라가는 것은 없다 -- 사진은 이 탭 안에서만 열린다.
 */

import type { Worker } from 'tesseract.js';

/** 읽는 동안의 진행. 화면이 그대로 적는다. */
export interface OcrProgress {
  /** 0~100 */
  percent: number;
  /** tesseract 가 지금 하는 일 ("loading language traineddata" 등) */
  status: string;
}

/**
 * 만들어 둔 일꾼. 사진마다 새로 만들지 않는다.
 *
 * 일꾼을 세우는 데 모델을 읽는 시간이 들어서, 한 장 읽고 버리면 두 번째 사진도
 * 처음처럼 느리다. 탭이 살아 있는 동안 하나를 둔다.
 */
let workerPromise: Promise<Worker> | null = null;

async function getWorker(onProgress?: (progress: OcrProgress) => void): Promise<Worker> {
  if (workerPromise) return workerPromise;

  /*
   * tesseract.js 는 브라우저에서만 돈다(WASM 과 웹 워커). 화면이 열릴 때가 아니라
   * 사진을 올릴 때 불러온다 -- 첫 화면의 번들에 10MB 짜리 길을 얹지 않는다.
   */
  workerPromise = (async () => {
    const { createWorker } = await import('tesseract.js');
    return createWorker(['kor', 'eng'], 1, {
      logger: (message) => {
        onProgress?.({
          percent: Math.round((message.progress ?? 0) * 100),
          status: message.status ?? '',
        });
      },
    });
  })();

  try {
    return await workerPromise;
  } catch (error) {
    // 실패한 약속을 남겨 두면 다음 시도가 그 실패를 그대로 다시 받는다.
    workerPromise = null;
    throw error;
  }
}

/**
 * 한 번에 읽는 높이. 이보다 긴 사진은 잘라서 읽는다.
 *
 * 화면 캡처는 세로로 아주 길다(실제 카드 앱 이용내역이 1440x12567 이었다). 통째로
 * 넘기면 tesseract 가 절반쯤만 읽어 낸다 -- 54건 중 23건만 걸린 것을 확인했다
 * (2026-09-09). 잘라서 읽으면 한 조각이 보통 화면 한 장 크기가 되어 다 읽힌다.
 */
const TILE_HEIGHT = 2000;

/**
 * 조각이 겹치는 높이. 경계에 걸친 줄을 잃지 않기 위한 여유다.
 *
 * 겹친 만큼 같은 줄이 두 조각에 나온다. 그 되풀이는 이어 붙일 때 걷어낸다
 * (`mergeTexts`).
 */
const TILE_OVERLAP = 160;

/**
 * 사진에서 글자를 읽어 **보이는 순서**로 잇는다.
 *
 * 줄을 y 순서로만 세우면 목록 화면에서 가맹점과 금액이 어긋난다. 가운데 높이가
 * 비슷한 줄을 한 줄로 묶고 그 안에서 왼쪽부터 이어, 사람이 읽는 순서와 같게 만든다
 * (앱의 네이티브 쪽 `layoutText` 와 같은 규칙이다).
 *
 * 긴 사진은 위에서 아래로 잘라 조각마다 읽는다. 진행은 조각 수로 센다.
 */
export async function recognizeCapture(
  file: Blob,
  onProgress?: (progress: OcrProgress) => void,
): Promise<string> {
  const tiles = await sliceTall(file);

  /*
   * 조각의 글자를 이어 붙이지 않고, **사진 전체의 좌표로 모은다.**
   *
   * 글자로 이어 붙이면 겹친 자리를 걷어낼 수 없다 -- 같은 줄을 두 조각이 조금 다르게
   * 읽어서("59.800워" / "59,800원") 글자 비교로는 같은 줄인지 알 수 없다. 좌표로 모으면
   * 같은 자리에 겹쳐 있는 것이 보이고, 그때는 먼저 읽은 것만 남긴다.
   */
  const lines: OcrLine[] = [];
  for (const [index, tile] of tiles.entries()) {
    const read = await recognizeOne(tile.image, (progress) =>
      onProgress?.({
        // 조각 하나의 진행을 전체 진행으로 옮긴다. 한 조각만이면 그대로다.
        percent: Math.round(((index + progress.percent / 100) / tiles.length) * 100),
        status: progress.status,
      }),
    );

    for (const line of read) {
      lines.push({ ...line, top: line.top + tile.top, bottom: line.bottom + tile.top });
    }
  }

  return layoutLines(lines);
}

/** 조각 하나를 읽어 줄과 그 자리를 돌려준다. 자리는 그 조각 안에서의 값이다. */
async function recognizeOne(
  image: Blob,
  onProgress?: (progress: OcrProgress) => void,
): Promise<OcrLine[]> {
  const worker = await getWorker(onProgress);
  const { data } = await worker.recognize(image, {}, { blocks: true, text: true });

  const lines = (data.blocks ?? [])
    .flatMap((block) => block.paragraphs ?? [])
    .flatMap((paragraph) => paragraph.lines ?? []);

  /*
   * 줄 정보가 없으면 tesseract 가 준 글자를 한 줄씩 쓴다.
   *
   * 자리를 모르므로 순서대로 세워 둔다 -- 겹침을 걷어낼 수 없고 두 열이 어긋날 수
   * 있지만, 아무것도 읽지 못하는 것보다 낫다.
   */
  if (lines.length === 0) {
    return (data.text ?? '')
      .split(/\r?\n/)
      .map((text, index) => ({ text: text.trim(), top: index, bottom: index, left: 0, right: 0 }))
      .filter((line) => line.text);
  }

  return lines.map((line) => ({
    text: line.text.trim(),
    top: line.bbox.y0,
    bottom: line.bbox.y1,
    left: line.bbox.x0,
    right: line.bbox.x1,
  }));
}

/**
 * 긴 사진을 위에서 아래로 자른다. 짧으면 그대로 한 조각이다.
 *
 * 자르는 일은 캔버스로 한다. 사진은 이 탭 안에서만 열리고, 조각도 메모리에만 있다.
 */
async function sliceTall(file: Blob): Promise<Tile[]> {
  const whole = [{ image: file, top: 0 }];

  // 브라우저가 이 사진을 열지 못하면 자르지 않고 그대로 넘긴다(tesseract 가 다시 시도한다).
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return whole;
  }

  if (bitmap.height <= TILE_HEIGHT) {
    bitmap.close();
    return whole;
  }

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) {
    bitmap.close();
    return whole;
  }

  const tiles: Tile[] = [];
  const step = TILE_HEIGHT - TILE_OVERLAP;

  for (let top = 0; top < bitmap.height; top += step) {
    const height = Math.min(TILE_HEIGHT, bitmap.height - top);
    // 남은 높이가 겹침보다 얇으면 앞 조각이 이미 담은 자리다.
    if (height <= TILE_OVERLAP && top > 0) break;

    canvas.width = bitmap.width;
    canvas.height = height;
    context.drawImage(bitmap, 0, top, bitmap.width, height, 0, 0, bitmap.width, height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((value) => resolve(value), 'image/png'),
    );
    if (blob) tiles.push({ image: blob, top });
  }

  bitmap.close();
  return tiles.length > 0 ? tiles : whole;
}

/** 잘라 낸 조각 하나와 그것이 사진의 어디였는지. */
interface Tile {
  image: Blob;
  top: number;
}

/** 다 읽고 나면 일꾼을 놓아 준다. 화면을 떠날 때 부른다. */
export async function releaseCaptureWorker(): Promise<void> {
  const pending = workerPromise;
  workerPromise = null;
  if (!pending) return;

  try {
    const worker = await pending;
    await worker.terminate();
  } catch {
    // 세우다 실패한 일꾼이다. 놓아 줄 것도 없다.
  }
}

interface OcrLine {
  text: string;
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * 읽은 조각을 화면에 보이던 줄로 되돌린다.
 *
 * 가운데 높이의 차이가 그 줄 높이의 절반 안이면 같은 줄로 본다. 글자 크기가 줄마다
 * 달라서 "절반"의 기준은 그 줄에 먼저 들어온 조각의 높이로 잡는다.
 *
 * **같은 자리를 두 번 읽은 것은 버린다.** 조각을 겹쳐 잘랐으므로 경계의 줄은 두 조각에
 * 나오고, 그 둘은 글자가 조금 다르게 읽힌다("59.800워" / "59,800원"). 자리가 겹치면
 * 먼저 읽은 것만 남긴다 -- 그러지 않으면 같은 거래가 후보 둘로 늘어난다.
 */
function layoutLines(lines: OcrLine[]): string {
  interface Row {
    centerY: number;
    tolerance: number;
    parts: OcrLine[];
  }

  const rows: Row[] = [];

  for (const line of [...lines].sort((a, b) => a.top - b.top || a.left - b.left)) {
    if (!line.text) continue;

    const centerY = (line.top + line.bottom) / 2;
    const row = rows.find((candidate) => Math.abs(candidate.centerY - centerY) <= candidate.tolerance);

    if (!row) {
      rows.push({
        centerY,
        tolerance: Math.max(1, (line.bottom - line.top) / 2),
        parts: [line],
      });
      continue;
    }

    // 이 줄에 이미 같은 자리(가로 범위가 절반 넘게 겹치는)가 있으면 두 번 읽은 것이다.
    if (row.parts.some((part) => overlapsHorizontally(part, line))) continue;
    row.parts.push(line);
  }

  return rows
    .sort((a, b) => a.centerY - b.centerY)
    .map((row) =>
      row.parts
        .sort((a, b) => a.left - b.left)
        .map((part) => part.text)
        .join(' '),
    )
    .join('\n');
}

/** 두 조각이 가로로 절반 넘게 겹치는가. 좌표가 없는 경우(글자만)에는 겹치지 않는다. */
function overlapsHorizontally(one: OcrLine, other: OcrLine): boolean {
  const width = Math.min(one.right - one.left, other.right - other.left);
  if (width <= 0) return false;

  const shared = Math.min(one.right, other.right) - Math.max(one.left, other.left);
  return shared > width / 2;
}
