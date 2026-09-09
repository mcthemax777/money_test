package expo.modules.inboxnative

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import org.json.JSONObject

/**
 * 기기로 오는 알림을 듣는 서비스.
 *
 * 안드로이드는 이 서비스를 앱과 따로 깨운다. 사용자가 설정에서 알림 접근을 허용하면,
 * 앱이 꺼져 있어도 알림이 올 때마다 `onNotificationPosted` 가 불린다. 자바스크립트는
 * 그때 돌고 있지 않으므로 여기서는 문구만 버퍼에 적고 해석은 앱이 열릴 때 한다.
 *
 * **읽는 것은 글자뿐이다.** 알림의 제목·본문·보낸 앱·온 시각만 담고, 아이콘이나
 * 사람 정보, 답장 같은 동작은 건드리지 않는다. 담은 글자는 이 기기 안에서 해석되고,
 * 거래 후보가 된 것만 사용자가 눌러 저장할 때 서버로 간다.
 *
 * **안드로이드 15 는 일부 알림을 가린다.** OTP 로 분류된 알림은 우리 같은 제3자
 * 리스너에게 본문 대신 "Sensitive notification content hidden" 이 온다(공식 문서의
 * behavior change). 카드 승인 문구에 끝 네 자리가 붙어 있으면 그 분류에 걸리는 것을
 * 에뮬레이터에서 확인했다(2026-09-08). 가려진 문구에는 금액이 없어 파서가 후보로
 * 만들지 않으므로 조용히 버려진다 -- 그 결제는 캡처 인식용 탭으로 적으면 된다.
 *
 * 걸러 내는 것이 이 서비스의 일 절반이다. 하루에 오는 알림은 수십에서 수백 건이고
 * 그 대부분은 돈과 무관하다. 여기서는 값싼 조건(진행 중인 알림, 묶음 머리글, 우리
 * 앱 자신)만 보고, 금융 알림인지 아닌지는 문구 규칙이 있는 자바스크립트가 정한다.
 */
class InboxNotificationService : NotificationListenerService() {
  override fun onNotificationPosted(sbn: StatusBarNotification?) {
    val notification = sbn?.notification ?: return

    /*
     * 진행 중인 알림은 거래가 아니다.
     *
     * 음악 재생, 파일 내려받기, 내비게이션처럼 계속 갱신되는 알림이다. 값이 바뀔
     * 때마다 다시 오므로 담아 두면 버퍼가 이것만으로 찬다.
     */
    if (notification.flags and Notification.FLAG_ONGOING_EVENT != 0) return
    if (notification.flags and Notification.FLAG_GROUP_SUMMARY != 0) return

    // 우리 앱이 낸 알림은 듣지 않는다. 스스로를 다시 읽는 고리가 된다.
    if (sbn.packageName == applicationContext.packageName) return

    val extras = notification.extras
    val title = extras?.getCharSequence(Notification.EXTRA_TITLE)?.toString()?.trim()
    /*
     * 본문. 긴 글이 있으면 그것을 쓴다.
     *
     * 카드 승인 문구는 여러 줄이라 `EXTRA_TEXT` 에는 첫 줄만 오고 나머지는
     * `EXTRA_BIG_TEXT` 에 들어간다. 짧은 쪽만 읽으면 가맹점과 시각을 잃는다.
     */
    val big = extras?.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString()?.trim()
    val short = extras?.getCharSequence(Notification.EXTRA_TEXT)?.toString()?.trim()
    val text = listOf(big, short).firstOrNull { !it.isNullOrEmpty() } ?: return

    /*
     * 열쇠. 같은 알림의 재전송을 하나로 모은다.
     *
     * 문구를 함께 넣는 이유가 있다. 안드로이드의 알림 id 는 앱이 재사용하는 값이라,
     * 카드사 앱이 같은 id 로 다음 결제를 알리면 id 만으로는 같은 것으로 보인다.
     */
    val key = "${sbn.packageName}:${sbn.id}:${(title ?: "").hashCode()}:${text.hashCode()}"

    val item = JSONObject().apply {
      put("key", key)
      put("packageName", sbn.packageName)
      put("title", title ?: JSONObject.NULL)
      put("text", text)
      // 알림이 온 시각. 문구에 날짜가 없을 때 자바스크립트가 이 값을 쓴다.
      put("postedAt", sbn.postTime)
    }

    NotificationBuffer.add(applicationContext, item)
  }

  /**
   * 알림이 지워졌을 때는 아무것도 하지 않는다.
   *
   * 사용자가 알림을 스와이프해 지웠다는 것이 "그 결제가 없던 일이 되었다"는 뜻은
   * 아니다. 담아 둔 후보는 그대로 남고, 필요 없으면 보관함에서 무시하면 된다.
   */
  override fun onNotificationRemoved(sbn: StatusBarNotification?) = Unit
}
