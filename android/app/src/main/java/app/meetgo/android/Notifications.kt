package app.meetgo.android

import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import androidx.core.app.RemoteInput

/** Message notifications: one per conversation (notification id = conversation id) in Android's conversation style,
 *  with its latest lines, Reply and Mark as read ([NotificationActions]); tapping it opens the conversation. */
object Notifications {
    const val ACTION_REPLY = "app.meetgo.android.REPLY"
    const val ACTION_READ = "app.meetgo.android.READ"
    const val KEY_REPLY = "reply"
    const val EXTRA_CONVERSATION = "app.meetgo.android.CONVERSATION"
    const val EXTRA_MESSAGE = "app.meetgo.android.MESSAGE"
    private const val MAX_LINES = 8
    private const val BRAND = 0xFF1E90FF.toInt()
    // what the notification itself remembers, to rebuild it if Android closed the app in between
    private const val X_KIND = "meetgo.kind"
    private const val X_TITLE = "meetgo.title"
    private const val X_URL = "meetgo.url"
    private const val X_MESSAGE = "meetgo.message"

    /** The app is on screen (MainActivity resumed). */
    @Volatile var foreground = false
    /** The conversation the page has open (0 = none), from MeetGoNative.setActiveConversation. */
    @Volatile var activeConversation = 0
    /** Unread messages, from MeetGoNative.setBadge (and one more for each notified message). */
    @Volatile var badge = 0

    /** [person] null = a line of the person using the app ("Tú"). */
    private class Line(val text: CharSequence, val time: Long, val person: Person?)

    private class Conv(var kind: String, var title: String, var url: String, var message: Long) {
        val lines = ArrayList<Line>()
    }

    private val convs = HashMap<Int, Conv>()

    /** Channels by conversation kind (the push data's conversation_kind): the person chooses sound and importance. */
    fun ensureChannels(context: Context) {
        val nm = context.getSystemService(NotificationManager::class.java) ?: return
        for ((id, name) in listOf("dm" to R.string.channel_dm, "group" to R.string.channel_group, "channel" to R.string.channel_channel)) {
            nm.createNotificationChannel(NotificationChannel(id, context.getString(name), NotificationManager.IMPORTANCE_HIGH))
        }
    }

    /** A message from the push service ([PushService]): it joins its conversation's notification. */
    @Synchronized
    fun show(context: Context, d: Map<String, String>) {
        val id = d["conversation_id"]?.toIntOrNull() ?: return
        if (foreground && activeConversation == id) return
        val kind = d["conversation_kind"]?.takeIf { it == "dm" || it == "group" || it == "channel" } ?: "dm"
        val sender = d["sender_name"].orEmpty()
        val title = d["title"].orEmpty().ifEmpty { sender.ifEmpty { context.getString(R.string.app_name) } }
        // in groups and channels the server writes "Name: text"; the conversation style already shows the name
        var body = d["body"].orEmpty()
        if (sender.isNotEmpty() && body.startsWith("$sender: ")) body = body.substring(sender.length + 2)
        val time = d["sent_at"]?.toLongOrNull()?.let { it * 1000 } ?: System.currentTimeMillis()
        val who = sender.ifEmpty { title }
        val c = conv(context, id) ?: Conv(kind, title, "", 0L).also { convs[id] = it }
        c.kind = kind
        c.title = title
        c.url = d["url"]?.takeIf { it.startsWith("/") } ?: "/app/c/$id"
        d["message_id"]?.toLongOrNull()?.let { c.message = it }
        add(c, Line(body, time, Person.Builder().setName(who).setKey(who).build()))
        badge += 1
        post(context, id, c, alert = true)
    }

    /** The reply sent from the notification, as a line of "Tú". */
    @Synchronized
    fun addReply(context: Context, id: Int, text: String) {
        val c = conv(context, id) ?: return
        add(c, Line(text, System.currentTimeMillis(), null))
        post(context, id, c, alert = false)
    }

    /** A line from MeetGo itself in the conversation's notification (e.g. why a reply could not be sent). */
    @Synchronized
    fun addNotice(context: Context, id: Int, text: String) {
        val c = conv(context, id) ?: return
        val app = context.getString(R.string.app_name)
        add(c, Line(text, System.currentTimeMillis(), Person.Builder().setName(app).setKey("meetgo").build()))
        post(context, id, c, alert = false)
    }

    /** Shows the notification again unchanged (Android waits for that after an empty reply). */
    @Synchronized
    fun refresh(context: Context, id: Int) {
        val c = conv(context, id) ?: return
        post(context, id, c, alert = false)
    }

    @Synchronized
    fun cancel(context: Context, id: Int) {
        convs.remove(id)
        NotificationManagerCompat.from(context).cancel(id)
    }

    @Synchronized
    fun cancelAll(context: Context) {
        convs.clear()
        badge = 0
        NotificationManagerCompat.from(context).cancelAll()
    }

    private fun add(c: Conv, line: Line) {
        c.lines += line
        while (c.lines.size > MAX_LINES) c.lines.removeAt(0)
    }

    /** The conversation's lines: in memory, else rebuilt from its notification on screen (null if there is none). */
    private fun conv(context: Context, id: Int): Conv? {
        convs[id]?.let { return it }
        val n = try {
            context.getSystemService(NotificationManager::class.java)?.activeNotifications?.firstOrNull { it.id == id }?.notification
        } catch (_: Exception) { null } ?: return null
        val x = n.extras
        val c = Conv(x.getString(X_KIND) ?: "dm", x.getString(X_TITLE) ?: "", x.getString(X_URL) ?: "/app/c/$id", x.getLong(X_MESSAGE))
        NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(n)?.messages?.forEach { m ->
            c.lines += Line(m.text ?: "", m.timestamp, m.person)
        }
        convs[id] = c
        return c
    }

    private fun actionIntent(context: Context, action: String, id: Int, message: Long): Intent =
        Intent(context, NotificationActions::class.java).setAction(action)
            .putExtra(EXTRA_CONVERSATION, id).putExtra(EXTRA_MESSAGE, message)

    @SuppressLint("MissingPermission")   // checked with areNotificationsEnabled()
    private fun post(context: Context, id: Int, c: Conv, alert: Boolean) {
        val nm = NotificationManagerCompat.from(context)
        if (!nm.areNotificationsEnabled()) return
        ensureChannels(context)
        val me = Person.Builder().setName(context.getString(R.string.you)).setKey("me").build()
        val style = NotificationCompat.MessagingStyle(me)
            .setConversationTitle(if (c.kind == "dm") null else c.title)
            .setGroupConversation(c.kind != "dm")
        for (l in c.lines) style.addMessage(NotificationCompat.MessagingStyle.Message(l.text, l.time, l.person))

        val server = Prefs(context).server.ifEmpty { MainActivity.DEFAULT_SERVER }
        val open = Intent(context, MainActivity::class.java).setAction(Intent.ACTION_VIEW)
            .setData(Uri.parse(server + c.url)).putExtra(EXTRA_CONVERSATION, id)
        val replyLabel = context.getString(R.string.notif_reply)
        val reply = NotificationCompat.Action.Builder(R.drawable.ic_notification, replyLabel,
            PendingIntent.getBroadcast(context, id * 2, actionIntent(context, ACTION_REPLY, id, c.message),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE))
            .addRemoteInput(RemoteInput.Builder(KEY_REPLY).setLabel(replyLabel).build())
            .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
            .setShowsUserInterface(false)
            .build()
        val read = NotificationCompat.Action.Builder(R.drawable.ic_notification, context.getString(R.string.notif_mark_read),
            PendingIntent.getBroadcast(context, id * 2 + 1, actionIntent(context, ACTION_READ, id, c.message),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
            .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_MARK_AS_READ)
            .setShowsUserInterface(false)
            .build()

        val last = c.lines.lastOrNull()
        val n = NotificationCompat.Builder(context, c.kind)
            .setSmallIcon(R.drawable.ic_notification)
            .setColor(BRAND)
            .setContentTitle(c.title)
            .setContentText(last?.text)
            .setStyle(style)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setWhen(last?.time ?: System.currentTimeMillis())
            .setShowWhen(true)
            .setNumber(badge)
            .setAutoCancel(true)
            .setSilent(!alert)
            .setContentIntent(PendingIntent.getActivity(context, id, open,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
            .addAction(reply)
            .addAction(read)
            .addExtras(Bundle().apply {
                putString(X_KIND, c.kind); putString(X_TITLE, c.title); putString(X_URL, c.url); putLong(X_MESSAGE, c.message)
            })
            .build()
        nm.notify(id, n)
    }
}
