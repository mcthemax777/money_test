package expo.modules.inboxnative

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.korean.KoreanTextRecognizerOptions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * 읽은 조각을 화면에 보이던 모양으로 되돌린다.
 *
 * 가운데 높이가 조각 높이의 절반 안에 드는 것끼리 한 줄로 묶는다. 글자 크기가 줄마다
 * 다를 수 있어 "절반"의 기준은 그 줄에 먼저 들어온 조각의 높이로 잡는다.
 */
private fun layoutText(lines: List<com.google.mlkit.vision.text.Text.Line>): String {
  data class Row(val centerY: Int, val tolerance: Int, val parts: MutableList<Pair<Int, String>>)

  val rows = mutableListOf<Row>()

  for (line in lines.sortedBy { it.boundingBox?.top ?: 0 }) {
    val box = line.boundingBox ?: continue
    val centerY = box.centerY()
    val row = rows.firstOrNull { kotlin.math.abs(it.centerY - centerY) <= it.tolerance }

    if (row == null) {
      rows.add(
        Row(
          centerY = centerY,
          // 절반이면 두 줄이 붙어 있어도 섞이지 않고, 같은 줄의 위아래 흔들림은 담긴다.
          tolerance = kotlin.math.max(1, box.height() / 2),
          parts = mutableListOf(box.left to line.text),
        ),
      )
    } else {
      row.parts.add(box.left to line.text)
    }
  }

  return rows
    .sortedBy { it.centerY }
    .map { row -> row.parts.sortedBy { it.first }.joinToString(" ") { it.second } }
    .joinToString("\n")
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
     */
    AsyncFunction("recognizeText") { uri: String, promise: Promise ->
      val image = try {
        InputImage.fromFilePath(context, Uri.parse(uri))
      } catch (error: Exception) {
        promise.reject(CodedException("IMAGE_UNREADABLE", "사진을 열지 못했습니다.", error))
        return@AsyncFunction
      }

      val recognizer = TextRecognition.getClient(KoreanTextRecognizerOptions.Builder().build())
      recognizer.process(image)
        .addOnSuccessListener { result ->
          promise.resolve(layoutText(result.textBlocks.flatMap { block -> block.lines }))
        }
        .addOnFailureListener { error ->
          promise.reject(CodedException("OCR_FAILED", "사진에서 글자를 읽지 못했습니다.", error))
        }
        .addOnCompleteListener { recognizer.close() }
    }
  }
}
