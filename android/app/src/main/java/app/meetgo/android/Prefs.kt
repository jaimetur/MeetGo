package app.meetgo.android

import android.content.Context

/** Settings of the app: the MeetGo server it shows, the session the web app hands over (for replying from the
 *  notifications) and the push token. Private to the app and not backed up. */
class Prefs(context: Context) {
    private val sp = context.getSharedPreferences("meetgo", Context.MODE_PRIVATE)

    /** Address of the MeetGo server (https://…, without the final slash); empty until the first set-up. */
    var server: String
        get() = sp.getString("server", "") ?: ""
        set(v) = sp.edit().putString("server", v.trim().trimEnd('/')).apply()

    /** The API the web app uses (e.g. https://api.meetgo.app); empty while signed out. */
    val apiBase: String get() = sp.getString("apiBase", "") ?: ""

    /** The account's access token; empty while signed out. */
    val token: String get() = sp.getString("token", "") ?: ""

    /** The person signed out in the app: notifications that still arrive are not shown. */
    val signedOut: Boolean get() = sp.getBoolean("signedOut", false)

    fun setSession(apiBase: String, token: String) =
        sp.edit().putString("apiBase", apiBase).putString("token", token).putBoolean("signedOut", false).apply()

    fun clearSession() = sp.edit().remove("apiBase").remove("token").putBoolean("signedOut", true).apply()

    /** The Firebase Cloud Messaging token of this installation; empty until Firebase gives it. */
    var pushToken: String
        get() = sp.getString("pushToken", "") ?: ""
        set(v) = sp.edit().putString("pushToken", v).apply()

    /** Android 13+: the notification permission was already asked once. */
    var askedNotifications: Boolean
        get() = sp.getBoolean("askedNotifications", false)
        set(v) = sp.edit().putBoolean("askedNotifications", v).apply()
}
