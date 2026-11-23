package app.meetgo.android

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.RemoteInput
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.util.UUID

/** Reply and Mark as read, from a message notification: the API is called in the background, with the session the
 *  web app handed over. */
class NotificationActions : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val app = context.applicationContext
        val id = intent.getIntExtra(Notifications.EXTRA_CONVERSATION, 0)
        if (id == 0) return
        when (intent.action) {
            Notifications.ACTION_READ -> {
                val message = intent.getLongExtra(Notifications.EXTRA_MESSAGE, 0L)
                Notifications.cancel(app, id)
                if (message > 0L) inBackground {
                    Api.post(app, "/conversations/$id/read", JSONObject().put("message_id", message))
                }
            }
            Notifications.ACTION_REPLY -> {
                val text = RemoteInput.getResultsFromIntent(intent)?.getCharSequence(Notifications.KEY_REPLY)?.toString()?.trim().orEmpty()
                if (text.isEmpty()) {
                    Notifications.refresh(app, id)
                    return
                }
                inBackground {
                    val body = JSONObject().put("body", text).put("client_id", UUID.randomUUID().toString())
                    when (Api.post(app, "/conversations/$id/messages", body)) {
                        in 200..299 -> Notifications.addReply(app, id, text)
                        402 -> Notifications.addNotice(app, id, app.getString(R.string.notif_subscription))
                        Api.NO_SESSION, 401 -> Notifications.addNotice(app, id, app.getString(R.string.notif_signed_out))
                        else -> Notifications.addNotice(app, id, app.getString(R.string.notif_failed))
                    }
                }
            }
        }
    }

    /** Runs [work] off the main thread, keeping the receiver alive until it ends. */
    private fun inBackground(work: () -> Unit) {
        val pending = goAsync()
        scope.launch {
            try { work() } finally { pending.finish() }
        }
    }

    private companion object {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    }
}
