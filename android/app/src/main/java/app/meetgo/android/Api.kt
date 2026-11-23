package app.meetgo.android

import android.content.Context
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** The few calls the app makes to the MeetGo API by itself (from the notifications), with the session the web app
 *  handed over (MeetGoNative.setSession). Never on the main thread. */
object Api {
    /** No session: the person is signed out, or the web app has not handed it over yet. */
    const val NO_SESSION = 0
    /** The request did not reach the API (no connection, timeout…). */
    const val NETWORK_ERROR = -1

    /** POSTs [body] as JSON to <apiBase><path>; returns the HTTP status, or [NO_SESSION] / [NETWORK_ERROR]. */
    fun post(context: Context, path: String, body: JSONObject): Int {
        val prefs = Prefs(context)
        if (prefs.apiBase.isEmpty() || prefs.token.isEmpty()) return NO_SESSION
        return try {
            val c = URL(prefs.apiBase + path).openConnection() as HttpURLConnection
            try {
                c.requestMethod = "POST"
                c.connectTimeout = 10000
                c.readTimeout = 15000
                c.doOutput = true
                c.setRequestProperty("Authorization", "Bearer " + prefs.token)
                c.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                c.setRequestProperty("Accept", "application/json")
                c.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
                c.responseCode
            } finally {
                c.disconnect()
            }
        } catch (_: Exception) {
            NETWORK_ERROR
        }
    }
}
