package app.meetgo.android

import android.content.ContentValues
import android.content.Intent
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import android.webkit.JavascriptInterface
import android.widget.Toast
import androidx.core.content.FileProvider
import java.io.File

/** What the web app can ask the Android app for (window.MeetGoNative in the page). The WebView only shows pages of
 *  the MeetGo server, so only those pages can call it. Methods run on a background thread. */
class NativeBridge(private val activity: MainActivity) {
    private val prefs = Prefs(activity)

    @JavascriptInterface
    fun appVersion(): String = activity.appVersion()

    /** After signing in, the API the page uses and the account's token (to reply from the notifications); an empty
     *  token when signing out, which forgets both and removes the notifications. */
    @JavascriptInterface
    fun setSession(apiBase: String, token: String) {
        val t = token.trim()
        if (t.isEmpty()) {
            prefs.clearSession()
            Notifications.cancelAll(activity)
            return
        }
        val api = apiBase.trim().trimEnd('/')
        if (api.startsWith("https://")) prefs.setSession(api, t)
    }

    /** The Firebase Cloud Messaging token ("" if push is unavailable or not ready yet: the page then hears it through
     *  window.mgNativePushToken). The first time, Android 13+ asks for permission to show notifications. */
    @JavascriptInterface
    fun getPushToken(): String {
        if (!Push.available(activity)) return ""
        activity.askNotifications()
        val t = prefs.pushToken
        if (t.isEmpty()) Push.refresh(activity)
        return t
    }

    /** The conversation the page shows (0 = none): while it is on screen its notifications are not shown. */
    @JavascriptInterface
    fun setActiveConversation(id: Int) {
        Notifications.activeConversation = id
        if (id != 0) Notifications.cancel(activity, id)
    }

    /** Unread count: the number the next notifications carry, for launchers that show it (best effort). */
    @JavascriptInterface
    fun setBadge(count: Int) {
        Notifications.badge = maxOf(0, count)
    }

    @JavascriptInterface
    fun openNotificationSettings() = activity.runOnUiThread { activity.openNotificationSettings() }

    @JavascriptInterface
    fun changeServer() = activity.runOnUiThread { activity.changeServer() }

    /** Plans of the Google Play subscription with their price ("[]" while Google Play does not offer them). */
    @JavascriptInterface
    fun billingProducts(): String = activity.billing.productsJson()

    /** Opens Google Play's purchase screen; the page hears the result through window.mgPurchase. */
    @JavascriptInterface
    fun subscribe(plan: String) = activity.billing.subscribe(plan)

    @JavascriptInterface
    fun restorePurchase() = activity.billing.restore()

    /** What another app shared into MeetGo, once: {"text": "...", "files": [{"name", "mime", "base64"}]}, or "{}". */
    @JavascriptInterface
    fun takeShared(): String = activity.takeShared()

    /** A file made by the page (a blob: or data: download): saved in Downloads and offered to open or share. */
    @JavascriptInterface
    fun saveFile(name: String, mime: String, base64: String) {
        val clean = name.replace(Regex("[\\\\/:*?\"<>|]"), "_").ifBlank { "MeetGo" }
        val bytes = try { Base64.decode(base64, Base64.DEFAULT) } catch (_: Exception) { return }
        try {
            // a copy the app can share, and (Android 10+) one in Downloads
            val dir = File(activity.cacheDir, "shared").apply { mkdirs() }
            val f = File(dir, clean).apply { writeBytes(bytes) }
            if (Build.VERSION.SDK_INT >= 29) {
                val v = ContentValues().apply {
                    put(MediaStore.Downloads.DISPLAY_NAME, clean); put(MediaStore.Downloads.MIME_TYPE, mime)
                    put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
                }
                activity.contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v)?.let { uri ->
                    activity.contentResolver.openOutputStream(uri)?.use { it.write(bytes) }
                }
            }
            val uri = FileProvider.getUriForFile(activity, activity.packageName + ".files", f)
            val send = Intent(Intent.ACTION_SEND).setType(mime).putExtra(Intent.EXTRA_STREAM, uri)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            activity.runOnUiThread {
                if (Build.VERSION.SDK_INT >= 29) Toast.makeText(activity, activity.getString(R.string.saved_downloads, clean), Toast.LENGTH_LONG).show()
                activity.startActivity(Intent.createChooser(send, clean))
            }
        } catch (e: Exception) {
            activity.runOnUiThread { Toast.makeText(activity, e.message ?: "Error", Toast.LENGTH_LONG).show() }
        }
    }
}
