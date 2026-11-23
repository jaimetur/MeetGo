package app.meetgo.android

import android.content.Context
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/** Push notifications with Firebase Cloud Messaging. Without google-services.json at build time Firebase does not
 *  start, and push is simply unavailable (MeetGoNative.getPushToken returns ""). The web app registers the token with
 *  the API itself. */
object Push {
    /** Hands a new token to the page (set by MainActivity while it exists). */
    @Volatile var onToken: ((String) -> Unit)? = null

    fun available(context: Context): Boolean =
        try { FirebaseApp.getApps(context).isNotEmpty() } catch (_: Throwable) { false }

    /** Asks Firebase for the token; when it is new, it is kept and given to the page. */
    fun refresh(context: Context) {
        if (!available(context)) return
        val app = context.applicationContext
        try {
            FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
                val token = if (task.isSuccessful) task.result else null
                if (!token.isNullOrEmpty()) changed(app, token)
            }
        } catch (_: Exception) { }
    }

    fun changed(context: Context, token: String) {
        val prefs = Prefs(context)
        if (token == prefs.pushToken) return
        prefs.pushToken = token
        onToken?.invoke(token)
    }
}

/** Receives the API's data messages (type "message") and shows them as notifications. */
class PushService : FirebaseMessagingService() {
    override fun onMessageReceived(remoteMessage: RemoteMessage) {
        val data = remoteMessage.data
        if (data["type"] != "message" || Prefs(this).signedOut) return
        Notifications.show(this, data)
    }

    override fun onNewToken(token: String) = Push.changed(this, token)
}
