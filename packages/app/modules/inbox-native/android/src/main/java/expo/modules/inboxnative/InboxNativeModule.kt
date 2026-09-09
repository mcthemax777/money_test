package expo.modules.inboxnative

import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.graphics.BitmapRegionDecoder
import android.graphics.Rect
import android.media.ExifInterface
import android.net.Uri
import android.provider.Settings
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.Text
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.TextRecognizer
import com.google.mlkit.vision.text.korean.KoreanTextRecognizerOptions
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext

/**
 * 한 번에 읽는 높이. 이보다 긴 사진은 잘라서 읽는다.
 *
 * 화면 캡처는 세로로 아주 길다(실제 카드 앱 이용내역이 1440x12567 이었다). 통째로
 * 넘기면 인식기가 사진을 제 크기로 줄여 보므로 글자가 뭉개져 목록의 절반이 빠진다 --
 * 웹(tesseract)에서 54건 중 23건만 걸린 것을 같은 사진으로 확인했다(2026-09-09).
 * 잘라서 읽으면 한 조각이 화면 한 장 크기가 되어 글자가 그만큼 크게 남는다.
 *
 * 웹의 `capture-ocr.ts` 와 같은 값이다. 두 길이 같은 사진에서 같은 후보를 내야 한다.
 */
private const val TILE_HEIGHT = 2000

/**
 * 조각이 겹치는 높이. 경계에 걸친 줄을 잃지 않기 위한 여유다.
 *
 * 겹친 만큼 같은 줄이 두 조각에 나온다. 그 되풀이는 이어 붙일 때 걷어낸다(`layoutText`).
 */
private const val TILE_OVERLAP = 160

/** 읽어 낸 줄 하나와 그것이 **사진 전체**에서 있던 자리. */
private data class OcrLine(
  val text: String,
  val top: Int,
  val bottom: Int,
  val left: Int,
  val right: Int,
  /**
   * 이 줄이 제 조각의 위·아래 가장자리에서 떨어진 거리.
   *
   * 경계에 걸린 줄은 반쪽만 보고 읽어 글자가 무너진다. 같은 자리를 두 조각이 읽었을
   * 때 어느 쪽을 믿을지 이 값으로 고른다(`layoutText`).
   */
  val edge: Int,
)

/**
 * ML Kit 이 준 줄을 사진 전체의 자리로 옮긴다.
 *
 * `offsetY` 는 이 조각이 시작한 높이, `tileHeight` 는 이 조각의 높이다(자르지 않았으면
 * 사진 높이).
 */
private fun ocrLinesOf(lines: List<Text.Line>, offsetY: Int, tileHeight: Int): List<OcrLine> =
  lines.mapNotNull { line ->
    val box = line.boundingBox ?: return@mapNotNull null
    val text = line.text.trim()
    if (text.isEmpty()) {
      null
    } else {
      OcrLine(
        text = text,
        top = box.top + offsetY,
        bottom = box.bottom + offsetY,
        left = box.left,
        right = box.right,
        edge = kotlin.math.min(box.top, tileHeight - box.bottom),
      )
    }
  }

/**
 * 읽은 조각을 화면에 보이던 모양으로 되돌린다.
 *
 * 가운데 높이가 조각 높이의 절반 안에 드는 것끼리 한 줄로 묶는다. 글자 크기가 줄마다
 * 다를 수 있어 "절반"의 기준은 그 줄에 먼저 들어온 조각의 높이로 잡는다.
 *
 * **같은 자리를 두 번 읽은 것은 하나만 남긴다.** 사진을 겹쳐 잘랐으므로 경계의 줄은 두
 * 조각에 나오고, 그 둘은 글자가 조금 다르게 읽힌다("59.800워" / "59,800원"). 둘 다 두면
 * 같은 거래가 후보 둘로 늘어난다.
 *
 * 남길 쪽은 **조각 가장자리에서 먼 것**이다(`edge`). 경계에 걸린 줄은 반쪽만 보고 읽어
 * 글자가 무너진다 -- 실제 캡처에서 날짜 머리 "09월04일" 이 걸린 조각에서는 "No<un4o!"
 * 로, 온전히 담긴 조각에서는 제대로 읽혔다(2026-09-09). 그것을 버리면 그 아래 거래들이
 * 앞 날짜를 이어 써서 하루씩 어긋난다.
 */
private fun layoutText(lines: List<OcrLine>): String {
  data class Row(val centerY: Int, val tolerance: Int, val parts: MutableList<OcrLine>)

  val rows = mutableListOf<Row>()

  for (line in lines.sortedWith(compareBy({ it.top }, { it.left }))) {
    val centerY = (line.top + line.bottom) / 2
    val row = rows.firstOrNull { kotlin.math.abs(it.centerY - centerY) <= it.tolerance }

    if (row == null) {
      rows.add(
        Row(
          centerY = centerY,
          // 절반이면 두 줄이 붙어 있어도 섞이지 않고, 같은 줄의 위아래 흔들림은 담긴다.
          tolerance = kotlin.math.max(1, (line.bottom - line.top) / 2),
          parts = mutableListOf(line),
        ),
      )
    } else {
      val at = row.parts.indexOfFirst { overlapsHorizontally(it, line) }
      if (at < 0) {
        row.parts.add(line)
      } else if (line.edge > row.parts[at].edge) {
        row.parts[at] = line
      }
    }
  }

  return rows
    .sortedBy { it.centerY }
    .map { row -> row.parts.sortedBy { it.left }.joinToString(" ") { it.text } }
    .joinToString("\n")
}

/** 두 조각이 가로로 절반 넘게 겹치는가. 겹치면 같은 자리를 두 번 읽은 것이다. */
private fun overlapsHorizontally(one: OcrLine, other: OcrLine): Boolean {
  val width = kotlin.math.min(one.right - one.left, other.right - other.left)
  if (width <= 0) return false

  val shared = kotlin.math.min(one.right, other.right) - kotlin.math.max(one.left, other.left)
  return shared > width / 2
}

/** 사진 한 장(또는 조각 하나)을 읽는다. ML Kit 의 콜백을 기다리는 자리다. */
private suspend fun recognize(recognizer: TextRecognizer, image: InputImage): List<Text.Line> =
  suspendCancellableCoroutine { continuation ->
    recognizer.process(image)
      .addOnSuccessListener { result ->
        continuation.resume(result.textBlocks.flatMap { block -> block.lines })
      }
      .addOnFailureListener { error ->
        continuation.resumeWithException(
          CodedException("OCR_FAILED", "사진에서 글자를 읽지 못했습니다.", error),
        )
      }
  }

/** 사진의 크기. 열지 못하면 null 이다. 화소를 읽지 않고 머리말만 본다. */
private fun imageSize(context: Context, uri: Uri): Pair<Int, Int>? {
  val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
  try {
    context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, options) }
      ?: return null
  } catch (error: Exception) {
    return null
  }
  if (options.outWidth <= 0 || options.outHeight <= 0) return null
  return options.outWidth to options.outHeight
}

/**
 * 사진이 적힌 대로 서 있는가 (EXIF 회전이 없는가).
 *
 * 자르는 일은 사진의 화소를 그대로 쓰므로, 90도 눕혀 찍힌 사진을 자르면 엉뚱한 축으로
 * 자른다. 그런 사진은 자르지 않고 통째로 넘긴다 -- `InputImage.fromFilePath` 가 회전을
 * 스스로 바로잡는다. 자르는 것이 필요한 긴 화면 캡처에는 회전이 붙지 않는다.
 */
private fun isUpright(context: Context, uri: Uri): Boolean {
  val orientation = try {
    context.contentResolver.openInputStream(uri)?.use { stream ->
      ExifInterface(stream).getAttributeInt(
        ExifInterface.TAG_ORIENTATION,
        ExifInterface.ORIENTATION_UNDEFINED,
      )
    }
  } catch (error: Exception) {
    // EXIF 를 못 읽는 사진(png 캡처가 그렇다)은 회전이 없는 것으로 본다.
    null
  } ?: return true

  return orientation == ExifInterface.ORIENTATION_UNDEFINED ||
    orientation == ExifInterface.ORIENTATION_NORMAL
}

/**
 * 사진의 일부만 떠서 읽을 수 있게 연다. 열 수 없으면 null 이다.
 *
 * `isShareable` 을 false 로 준다 -- 디코더가 압축된 자료를 스스로 복사해 들고 있어
 * 스트림을 닫은 뒤에도 조각을 뜰 수 있다. 화소를 다 펼치지 않으므로 1만 화소가 넘는
 * 캡처도 사진 한 장(1440x12567 이면 72MB)을 메모리에 올리지 않는다.
 */
private fun openTiles(context: Context, uri: Uri): BitmapRegionDecoder? = try {
  context.contentResolver.openInputStream(uri)?.use { stream ->
    @Suppress("DEPRECATION")
    BitmapRegionDecoder.newInstance(stream, false)
  }
} catch (error: Exception) {
  null
}

/**
 * 보관함의 기기 쪽 일. 알림을 읽고 사진에서 글자를 뽑는다.
 *
 * 해석은 하지 않는다. 문구를 거래 후보로 바꾸는 규칙은 자바스크립트(core 의
 * `draft-parse`)에 있고, 그래야 웹·앱·검사가 같은 규칙을 쓴다. 여기서 하는 일은
 * 안드로이드만 할 수 있는 둘뿐이다 -- 알림 듣기와 기기 OCR.
 */
class InboxNativeModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "안드로이드 컨텍스트가 없습니다." }

  override fun definition() = ModuleDefinition {
    Name("InboxNative")

    /**
     * 알림 접근이 허용되어 있는가.
     *
     * 시스템 설정의 값을 직접 읽는다. 이 권한은 런타임 요청으로 받을 수 없고 사용자가
     * 설정 화면에서 켜야 하므로, "요청" 대신 "확인 + 설정 열기" 두 함수로 둔다.
     */
    Function("isNotificationAccessGranted") {
      val enabled = Settings.Secure.getString(
        context.contentResolver,
        "enabled_notification_listeners",
      ) ?: return@Function false
      enabled.split(":").any { it.contains(context.packageName) }
    }

    /** 알림 접근 설정을 연다. 우리 앱을 켜는 자리다. */
    Function("openNotificationAccessSettings") {
      val intent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
      /*
       * 새 작업으로 띄운다.
       *
       * 이 인텐트는 우리 액티비티가 아니라 시스템 설정으로 가는 것이라, 지금 화면
       * 스택에 얹으면 뒤로가기가 설정 화면을 우리 앱의 한 겹으로 다룬다.
       */
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
    }

    /**
     * 담아 둔 알림을 읽는다. **지우지 않는다.**
     *
     * 자바스크립트가 이것을 후보로 만들어 서버에 담고, 담긴 것이 확인되면 그 열쇠만
     * 골라 지운다(`clearNotifications`). 읽으면서 지우면 그 사이 연결이 끊겼을 때
     * 알림이 사라진다.
     */
    Function("readNotifications") {
      val array = NotificationBuffer.read(context)
      (0 until array.length()).mapNotNull { index ->
        val item = array.optJSONObject(index) ?: return@mapNotNull null
        mapOf(
          "key" to item.optString("key"),
          "packageName" to item.optString("packageName"),
          "title" to if (item.isNull("title")) null else item.optString("title"),
          "text" to item.optString("text"),
          "postedAt" to item.optLong("postedAt"),
        )
      }
    }

    /** 서버에 담긴 것이 확인된 알림을 버퍼에서 지운다. */
    Function("clearNotifications") { keys: List<String> ->
      NotificationBuffer.clear(context, keys)
    }

    /**
     * 사진에서 글자를 읽는다. 기기 안에서만 돈다.
     *
     * 글자를 **화면에 보이는 대로** 이어 붙인다. ML Kit 이 주는 블록 순서는 목록
     * 화면에서 열을 따라 묶여("가맹점 세 줄" 다음에 "금액 세 줄"), 그대로 쓰면 어느
     * 금액이 어느 가게의 것인지 알 수 없다.
     *
     * 그래서 한 줄에 나란히 있는 것을 한 줄로 되돌린다 -- 가운데 높이가 비슷한
     * 조각을 같은 줄로 묶고, 줄 안에서는 왼쪽부터 잇는다. 목록 캡처에서 가맹점과
     * 금액이 같은 줄에 서고, 파서는 그 한 줄만 보고 후보를 만들 수 있다.
     *
     * **긴 사진은 위에서 아래로 잘라 조각마다 읽는다**(`TILE_HEIGHT`). 조각은
     * 필요한 자리만 떠서 읽으므로(`BitmapRegionDecoder`) 1만 화소가 넘는 캡처도
     * 사진 한 장을 한꺼번에 메모리에 올리지 않는다.
     */
    AsyncFunction("recognizeText") Coroutine { uri: String ->
      /*
       * 무거운 일은 다른 갈래에서 한다.
       *
       * 이 함수의 기본 갈래는 모듈 하나짜리 큐(`expo.modules.AsyncFunctionQueue`)라,
       * 여기서 조각마다 기다리면 그동안 다른 네이티브 부름(사본 읽기 등)이 함께 멈춘다.
       */
      val text = withContext(Dispatchers.Default) {
        val recognizer = TextRecognition.getClient(KoreanTextRecognizerOptions.Builder().build())

        try {
          layoutText(readImage(Uri.parse(uri), recognizer))
        } finally {
          recognizer.close()
        }
      }

      return@Coroutine text
    }
  }

  /** 사진 한 장을 읽어 줄로. 길면 조각으로 잘라 읽고 자리로 이어 붙인다. */
  private suspend fun readImage(uri: Uri, recognizer: TextRecognizer): List<OcrLine> {
    val size = imageSize(context, uri)
    val height = size?.second ?: 0

    if (height <= TILE_HEIGHT || !isUpright(context, uri)) return readWhole(uri, recognizer)

    // 조각으로 뜰 수 없는 사진(움직이는 webp 등)은 통째로 읽는다.
    val decoder = openTiles(context, uri) ?: return readWhole(uri, recognizer)

    val width = size?.first ?: decoder.width
    val lines = mutableListOf<OcrLine>()

    try {
      var top = 0
      while (top < height) {
        val tileHeight = kotlin.math.min(TILE_HEIGHT, height - top)
        // 남은 높이가 겹침보다 얇으면 앞 조각이 이미 담은 자리다.
        if (top > 0 && tileHeight <= TILE_OVERLAP) break

        val bitmap = decoder.decodeRegion(Rect(0, top, width, top + tileHeight), null)
        if (bitmap != null) {
          try {
            lines += ocrLinesOf(
              recognize(recognizer, InputImage.fromBitmap(bitmap, 0)),
              top,
              tileHeight,
            )
          } finally {
            bitmap.recycle()
          }
        }

        top += TILE_HEIGHT - TILE_OVERLAP
      }
    } finally {
      decoder.recycle()
    }

    // 한 조각도 읽지 못했으면 자르지 않은 사진으로 한 번 더 해 본다.
    return if (lines.isEmpty()) readWhole(uri, recognizer) else lines
  }

  /** 자르지 않고 사진 그대로 읽는다. 짧은 사진과, 자를 수 없는 사진의 길이다. */
  private suspend fun readWhole(uri: Uri, recognizer: TextRecognizer): List<OcrLine> {
    val image = try {
      InputImage.fromFilePath(context, uri)
    } catch (error: Exception) {
      throw CodedException("IMAGE_UNREADABLE", "사진을 열지 못했습니다.", error)
    }

    // 조각이 하나뿐이라 가장자리를 견줄 상대가 없다. 높이는 그 사진의 것을 그대로 쓴다.
    return ocrLinesOf(recognize(recognizer, image), 0, image.height)
  }
}
