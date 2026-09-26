package expo.modules.inboxnative

import android.content.Context
import android.content.Intent
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/**
 * 버퍼에 쌓인 알림을 곧바로 후보로 올리는 백그라운드 작업.
 *
 * 알림을 읽어 값으로 만드는 규칙은 자바스크립트(core 의 draft-parse)에 있다. 그래서
 * 알림이 오면 여기서 자바스크립트를 깨워 `InboxCollect` 작업을 돌린다 -- 앱이 꺼져
 * 있어도 후보가 담기고, 서버가 구성원 기기에 푸시를 보낸다.
 *
 * 작업이 실패하거나 아예 뜨지 못해도 알림은 버퍼에 남아 있다. 앱을 열어 "지금
 * 확인하기"를 누르면 그때 올라간다.
 */
class InboxCollectTaskService : HeadlessJsTaskService() {
  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig =
    HeadlessJsTaskConfig(
      TASK_NAME,
      Arguments.createMap(),
      TIMEOUT_MS,
      // 앱이 앞에 떠 있어도 돈다. 보관함을 보는 중에 온 결제도 곧바로 담겨야 한다.
      true,
    )

  companion object {
    /** 자바스크립트의 `AppRegistry.registerHeadlessTask` 와 같은 이름이어야 한다. */
    const val TASK_NAME = "InboxCollect"

    /**
     * 작업의 상한. 자바스크립트가 몇 초 모았다가(한 결제의 알림 여럿을 한 번에) 서버에
     * 올리므로, 느린 망까지 넉넉히 잡는다. 넘으면 작업만 끝나고 알림은 버퍼에 남는다.
     */
    private const val TIMEOUT_MS = 60_000L

    /**
     * 작업을 띄운다. 띄우지 못해도 조용히 넘어간다.
     *
     * 안드로이드는 백그라운드에서 서비스를 띄우는 것을 막을 때가 있다
     * (IllegalStateException). 그때도 알림은 이미 버퍼에 있어 잃는 것이 없다.
     */
    fun start(context: Context) {
      try {
        context.startService(Intent(context, InboxCollectTaskService::class.java))
        HeadlessJsTaskService.acquireWakeLockNow(context)
      } catch (error: Exception) {
        // 위의 까닭으로 삼킨다.
      }
    }
  }
}
