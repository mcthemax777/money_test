package expo.modules.inboxnative

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * 읽은 알림을 담아 두는 자리.
 *
 * **자바스크립트가 없을 때도 알림은 온다.** 결제 알림은 앱이 꺼져 있는 동안 도착하고,
 * 그때 리스너 서비스만 깨어난다. 그래서 해석은 나중에 하고 여기 문구만 적어 둔다.
 * 앱이 열리면 자바스크립트가 이 버퍼를 읽어 후보로 만든다.
 *
 * SharedPreferences 에 JSON 배열로 담는다. 방 하나 크기의 자료라 표를 만들 까닭이 없고,
 * 프로세스가 죽어도 남아야 하므로 메모리에 둘 수도 없다.
 *
 * **올린 것을 확인한 뒤에만 지운다.** 읽는 쪽(`read`)은 지우지 않고, 서버에 담긴 것이
 * 확인되면 그 열쇠만 골라 지운다(`clear`). 읽으면서 지우면 그 사이 연결이 끊겼을 때
 * 알림이 사라진다.
 */
object NotificationBuffer {
  private const val PREFS = "bboyong.inbox.notifications"
  private const val KEY = "items"

  /**
   * 담아 둘 최대 개수. 넘으면 오래된 것부터 버린다.
   *
   * 200 이면 결제 알림 기준으로 몇 주 분이다. 무한히 쌓게 두면 앱을 오래 열지 않은
   * 기기에서 이 값이 계속 커지고, 그 전체를 한 번에 파싱하게 된다.
   */
  private const val LIMIT = 200

  @Synchronized
  fun add(context: Context, item: JSONObject) {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val array = read(context)

    /*
     * 같은 열쇠는 담지 않는다.
     *
     * 안드로이드는 같은 알림을 여러 번 보낸다(내용이 조금 바뀔 때마다 onNotificationPosted
     * 가 다시 온다). 열쇠는 (앱, 알림 id, 문구)로 만들므로 그런 재전송이 하나로 모인다.
     */
    val key = item.optString("key")
    for (index in 0 until array.length()) {
      if (array.optJSONObject(index)?.optString("key") == key) return
    }

    array.put(item)

    // 오래된 것부터 버린다. JSONArray 에는 앞을 지우는 방법이 remove 뿐이다.
    while (array.length() > LIMIT) array.remove(0)

    prefs.edit().putString(KEY, array.toString()).apply()
  }

  @Synchronized
  fun read(context: Context): JSONArray {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val raw = prefs.getString(KEY, null) ?: return JSONArray()
    return try {
      JSONArray(raw)
    } catch (error: Exception) {
      // 담긴 글이 깨졌으면 버린다. 다음 알림부터 다시 쌓인다.
      JSONArray()
    }
  }

  /** 그 열쇠들을 지운다. 서버에 담긴 것이 확인된 뒤에 부른다. */
  @Synchronized
  fun clear(context: Context, keys: List<String>) {
    if (keys.isEmpty()) return

    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val kept = JSONArray()
    val array = read(context)
    for (index in 0 until array.length()) {
      val item = array.optJSONObject(index) ?: continue
      if (!keys.contains(item.optString("key"))) kept.put(item)
    }
    prefs.edit().putString(KEY, kept.toString()).apply()
  }
}
