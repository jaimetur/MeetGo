package app.meetgo.android

import android.Manifest
import android.annotation.SuppressLint
import android.app.DownloadManager
import android.content.ClipData
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color as AColor
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.provider.OpenableColumns
import android.provider.Settings
import android.util.Base64
import android.webkit.CookieManager
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.content.IntentCompat
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.atomic.AtomicReference

private val Night = Color(0xFF0B1220)
private val Blue = Color(0xFF1E90FF)
private val Green = Color(0xFF43D854)

/** The MeetGo app: the server's web app (<server>/app/) full screen, so every deployment of the web app updates the
 *  app too, with what a web page cannot do by itself — push notifications, Google Play subscriptions, sharing into the
 *  app, App Links, downloads, choosing files or taking a photo, the back button — through [NativeBridge]. */
class MainActivity : ComponentActivity() {
    private lateinit var prefs: Prefs
    private var web: WebView? = null
    private val page = mutableStateOf(Page.LOADING)
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var cameraFile: File? = null
    private var cameraUri: Uri? = null
    /** What the WebView opens when it is created (a link, a notification or a share that arrived before it existed):
     *  a whole address, or a path of the server. */
    private var pendingUrl: String? = null
    /** What another app shared into MeetGo, as JSON for the page (taken once with [takeShared]). */
    private val shared = AtomicReference<String?>(null)
    lateinit var bridge: NativeBridge
    lateinit var billing: Billing

    private enum class Page { SETUP, LOADING, READY, ERROR }

    private val chooseFiles = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        onFilesChosen(r.resultCode, r.data)
    }

    private val askPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        val splash = installSplashScreen()
        super.onCreate(savedInstanceState)
        enableEdgeToEdge(SystemBarStyle.dark(AColor.TRANSPARENT), SystemBarStyle.dark(AColor.TRANSPARENT))
        prefs = Prefs(this)
        bridge = NativeBridge(this)
        billing = Billing(this).also { it.start() }
        Notifications.ensureChannels(this)
        Push.onToken = { t -> js("window.mgNativePushToken&&window.mgNativePushToken(${JSONObject.quote(t)})") }
        Push.refresh(this)
        // MeetGo's own server straight away (the server screen stays for "change server" on the offline screen);
        // an address saved without "www" goes to www.meetgo.app, where meetgo.app redirects anyway.
        if (prefs.server.isEmpty() || prefs.server == "https://meetgo.app") prefs.server = DEFAULT_SERVER
        // the start screen stays until the page has loaded (or failed, or the server has to be set)
        val t0 = System.currentTimeMillis()
        splash.setKeepOnScreenCondition { page.value == Page.LOADING && System.currentTimeMillis() - t0 < 8000 }
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() = goBack()
        })
        setContent {
            MaterialTheme(colorScheme = darkColorScheme(primary = Blue, onPrimary = Color.White, background = Night,
                onBackground = Color.White, surface = Night, onSurface = Color.White)) {
                when (page.value) {
                    Page.SETUP -> Surface(Modifier.fillMaxSize()) { ServerSetup(prefs.server) { saveServer(it) } }
                    else -> Box(Modifier.fillMaxSize().background(Color(barColor)).safeDrawingPadding()) {
                        AndroidView(factory = { web ?: makeWebView().also { web = it } }, modifier = Modifier.fillMaxSize())
                        if (page.value == Page.ERROR) Surface(Modifier.fillMaxSize()) { Offline({ reload() }, { changeServer() }) }
                    }
                }
            }
        }
        if (savedInstanceState == null) handleIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        Notifications.foreground = true
        // the conversation on screen has nothing new to notify
        Notifications.activeConversation.takeIf { it != 0 }?.let { Notifications.cancel(this, it) }
    }

    override fun onPause() {
        super.onPause()
        Notifications.foreground = false
        CookieManager.getInstance().flush()
    }

    override fun onDestroy() {
        Push.onToken = null
        super.onDestroy()
    }

    private var barColor by mutableStateOf(0xFF0B1220.toInt())

    /** A link (App Links), a tapped notification or something shared from another app. */
    private fun handleIntent(intent: Intent?) {
        if (intent == null || (intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) return
        intent.getIntExtra(Notifications.EXTRA_CONVERSATION, 0).takeIf { it != 0 }?.let { Notifications.cancel(this, it) }
        when (intent.action) {
            Intent.ACTION_VIEW -> {
                val u = intent.data ?: return
                if (prefs.server.isEmpty()) pendingUrl = u.toString()   // opened once the server is chosen
                else resolve(u)?.let { open(it) }
            }
            Intent.ACTION_SEND, Intent.ACTION_SEND_MULTIPLE -> receiveShare(intent)
        }
    }

    /** The server's host, with or without "www." (meetgo.app redirects to www.meetgo.app: following that redirect
     *  inside the app must not count as leaving it, or the app would bounce between both addresses forever). */
    private fun sameServer(u: Uri): Boolean {
        if (prefs.server.isEmpty()) return false
        val bare = { h: String? -> (h ?: "").lowercase().removePrefix("www.") }
        return bare(Uri.parse(prefs.server).host) == bare(u.host)
    }

    /** A MeetGo address on the server the app uses: the same host, or meetgo.app ↔ www.meetgo.app (null otherwise). */
    private fun resolve(u: Uri): String? {
        if (u.scheme != "https" && u.scheme != "http") return null
        if (sameServer(u)) return u.toString()
        val bare = { h: String? -> (h ?: "").removePrefix("www.") }
        if (prefs.server.isEmpty() || bare(u.host) != bare(Uri.parse(prefs.server).host)) return null
        return prefs.server + (u.encodedPath ?: "/app/") + (u.encodedQuery?.let { "?$it" } ?: "")
    }

    /** Opens [target] (an address of the server, or a path of it) now, or when the WebView is created. */
    private fun open(target: String) {
        val w = web
        if (w == null || page.value == Page.SETUP) { pendingUrl = target; return }
        if (page.value == Page.ERROR) page.value = Page.LOADING
        w.loadUrl(if (target.startsWith("/")) prefs.server + target else target)
    }

    /** The first address of a new WebView: what arrived before it existed, else the web app. */
    private fun startUrl(): String {
        val p = pendingUrl ?: return prefs.server + "/app/"
        pendingUrl = null
        if (p.startsWith("/")) return prefs.server + p
        return resolve(Uri.parse(p)) ?: (prefs.server + "/app/")
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun makeWebView(): WebView = WebView(this).apply {
        setBackgroundColor(barColor)
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.mediaPlaybackRequiresUserGesture = true
        settings.allowFileAccess = false
        settings.userAgentString = settings.userAgentString + " MeetGoApp/" + appVersion()
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(this, false)
        addJavascriptInterface(bridge, "MeetGoNative")
        webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                request.isForMainFrame && route(view, request.url)

            override fun onPageFinished(view: WebView, url: String) {
                if (page.value != Page.ERROR) page.value = Page.READY
                // the bars around the page take the page's background colour (its theme)
                view.evaluateJavascript("getComputedStyle(document.body).backgroundColor") { c -> applyBarColor(c) }
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) page.value = Page.ERROR
            }

            override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, response: WebResourceResponse) {
                if (request.isForMainFrame && response.statusCode >= 500) page.value = Page.ERROR
            }
        }
        webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                return try { chooseFiles.launch(chooserIntent(params)); true } catch (_: Exception) { fileCallback = null; false }
            }
        }
        // files the server sends for download (the web app's own files go through NativeBridge.saveFile)
        setDownloadListener { url, ua, disposition, mime, _ ->
            if (!url.startsWith("http")) return@setDownloadListener
            val name = URLUtil.guessFileName(url, disposition, mime)
            try {
                val req = DownloadManager.Request(Uri.parse(url))
                    .addRequestHeader("User-Agent", ua)
                    .setMimeType(mime)
                    .setTitle(name)
                    .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                CookieManager.getInstance().getCookie(url)?.let { req.addRequestHeader("Cookie", it) }
                // Android 9 cannot write to the shared Downloads without the storage permission: the app's own folder
                if (Build.VERSION.SDK_INT >= 29) req.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name)
                else req.setDestinationInExternalFilesDir(this@MainActivity, Environment.DIRECTORY_DOWNLOADS, name)
                (getSystemService(DOWNLOAD_SERVICE) as DownloadManager).enqueue(req)
            } catch (_: Exception) { }
        }
        loadUrl(startUrl())
    }

    /** Pages of the server stay in the app; anything else (other sites, mailto:, tel:…) opens outside. */
    private fun route(view: WebView, u: Uri): Boolean {
        if ((u.scheme == "https" || u.scheme == "http") && sameServer(u)) return false
        val inside = resolve(u)
        if (inside != null) { view.loadUrl(inside); return true }
        try { startActivity(Intent(Intent.ACTION_VIEW, u)) } catch (_: Exception) { }
        return true
    }

    private fun applyBarColor(css: String?) {
        val m = Regex("""rgba?\((\d+),\s*(\d+),\s*(\d+)""").find(css ?: "") ?: return
        val (r, g, b) = m.destructured.toList().map { it.toInt() }
        barColor = AColor.rgb(r, g, b)
        val light = (r * 299 + g * 587 + b * 114) / 1000 > 140
        WindowInsetsControllerCompat(window, window.decorView).apply {
            isAppearanceLightStatusBars = light; isAppearanceLightNavigationBars = light
        }
    }

    /** Back: first what the page has open (a dialog, a thread, a conversation…), then the previous page, then leave. */
    private fun goBack() {
        val w = web
        if (w == null || page.value != Page.READY) { finish(); return }
        w.evaluateJavascript("(window.mgBack&&window.mgBack())?1:0") { r ->
            if (r == "1") return@evaluateJavascript
            if (w.canGoBack()) w.goBack() else finish()
        }
    }

    fun reload() {
        page.value = Page.LOADING
        web?.reload() ?: run { page.value = Page.READY }
    }

    /** Called by the page or the offline screen: go back to choosing the server (the session belonged to the old one). */
    fun changeServer() {
        prefs.server = ""
        prefs.clearSession()
        Notifications.cancelAll(this)
        web?.destroy(); web = null
        page.value = Page.SETUP
    }

    private fun saveServer(url: String) {
        prefs.server = url
        page.value = Page.LOADING
        web?.loadUrl(startUrl())
    }

    /** Runs a script in the page (from NativeBridge, Billing and Push, on the UI thread). */
    fun js(script: String) = runOnUiThread { web?.evaluateJavascript(script, null) }

    fun appVersion(): String = try {
        packageManager.getPackageInfo(packageName, 0).versionName ?: "0"
    } catch (_: Exception) { "0" }

    /** Android 13+: asks once for permission to show notifications (when the page first asks for the push token). */
    fun askNotifications() {
        if (Build.VERSION.SDK_INT < 33 || prefs.askedNotifications) return
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return
        prefs.askedNotifications = true
        runOnUiThread { try { askPermission.launch(Manifest.permission.POST_NOTIFICATIONS) } catch (_: Exception) { } }
    }

    fun openNotificationSettings() {
        try {
            startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, packageName))
        } catch (_: Exception) {
            try { startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName"))) } catch (_: Exception) { }
        }
    }

    // ---------- choosing files (or taking a photo) for the page ----------

    private fun chooserIntent(params: WebChromeClient.FileChooserParams): Intent {
        val types = params.acceptTypes.flatMap { it.split(',') }.map { it.trim().lowercase() }.filter { '/' in it }.distinct()
        val images = types.isEmpty() || types.any { it == "*/*" || it.startsWith("image/") }
        val pick = Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE)
            .setType(types.singleOrNull() ?: "*/*")
            .putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.mode == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE)
        if (types.size > 1) pick.putExtra(Intent.EXTRA_MIME_TYPES, types.toTypedArray())
        val camera = if (images) cameraIntent() else null
        if (camera != null && params.isCaptureEnabled) return camera
        return Intent.createChooser(pick, getString(R.string.choose_file)).apply {
            if (camera != null) putExtra(Intent.EXTRA_INITIAL_INTENTS, arrayOf(camera))
        }
    }

    /** The camera app, saving the photo in the app's cache (no camera permission needed). */
    private fun cameraIntent(): Intent? = try {
        val dir = File(cacheDir, "camera").apply { mkdirs() }
        val f = File(dir, "photo-${System.currentTimeMillis()}.jpg")
        val uri = FileProvider.getUriForFile(this, "$packageName.files", f)
        cameraFile = f; cameraUri = uri
        Intent(MediaStore.ACTION_IMAGE_CAPTURE).putExtra(MediaStore.EXTRA_OUTPUT, uri)
            .addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
            .apply { clipData = ClipData.newRawUri("", uri) }
    } catch (_: Exception) { null }

    private fun onFilesChosen(resultCode: Int, data: Intent?) {
        val callback = fileCallback ?: return
        fileCallback = null
        var uris: Array<Uri>? = null
        if (resultCode == RESULT_OK) {
            val clip = data?.clipData
            val picked = data?.data
            val photo = cameraUri
            uris = when {
                clip != null && clip.itemCount > 0 -> (0 until clip.itemCount).mapNotNull { clip.getItemAt(it).uri }.toTypedArray()
                picked != null -> arrayOf(picked)
                photo != null && (cameraFile?.length() ?: 0L) > 0L -> arrayOf(photo)
                else -> null
            }
        }
        cameraFile = null; cameraUri = null
        callback.onReceiveValue(uris)
    }

    // ---------- content shared from other apps ----------

    private fun receiveShare(intent: Intent) {
        val text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString().orEmpty()
        val uris: List<Uri> = if (intent.action == Intent.ACTION_SEND_MULTIPLE)
            IntentCompat.getParcelableArrayListExtra(intent, Intent.EXTRA_STREAM, Uri::class.java).orEmpty()
        else listOfNotNull(IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri::class.java))
        if (text.isBlank() && uris.isEmpty()) return
        lifecycleScope.launch {
            val files = withContext(Dispatchers.IO) { readShared(uris, intent.type) }
            shared.set(JSONObject().put("text", text).put("files", files).toString())
            open("/app/share")
        }
    }

    /** The shared files as [{name, mime, base64}] (at most 10, each up to the server's 10 MB limit). */
    private fun readShared(uris: List<Uri>, type: String?): JSONArray {
        val files = JSONArray()
        for (u in uris) {
            if (files.length() >= MAX_SHARED_FILES) break
            // only content shared by other apps: never a file path, nor this app's own files
            if (u.scheme != "content" || (u.authority ?: "").startsWith(packageName)) continue
            try {
                var name = "file"
                contentResolver.query(u, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
                    val i = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    if (c.moveToFirst() && i >= 0) c.getString(i)?.let { name = it }
                }
                val bytes = contentResolver.openInputStream(u)?.use { readCapped(it) } ?: continue
                val mime = contentResolver.getType(u) ?: type?.takeIf { '*' !in it } ?: "application/octet-stream"
                files.put(JSONObject().put("name", name).put("mime", mime).put("base64", Base64.encodeToString(bytes, Base64.NO_WRAP)))
            } catch (_: Exception) { }
        }
        return files
    }

    private fun readCapped(input: InputStream): ByteArray? {
        val out = ByteArrayOutputStream()
        val buf = ByteArray(64 * 1024)
        var total = 0L
        while (true) {
            val n = input.read(buf)
            if (n < 0) break
            total += n
            if (total > MAX_SHARED_BYTES) return null
            out.write(buf, 0, n)
        }
        return out.toByteArray()
    }

    /** For the page at /app/share: what was shared, once ("{}" when nothing). */
    fun takeShared(): String = shared.getAndSet(null) ?: "{}"

    // ---------- native screens ----------

    @Composable
    private fun Logo() {
        Text(buildAnnotatedString {
            withStyle(SpanStyle(color = Blue)) { append("Meet") }
            withStyle(SpanStyle(color = Green)) { append("Go") }
        }, fontSize = 36.sp, fontWeight = FontWeight.ExtraBold)
    }

    @Composable
    private fun ServerSetup(current: String, onSave: (String) -> Unit) {
        var url by remember { mutableStateOf(current.ifEmpty { DEFAULT_SERVER }) }
        var busy by remember { mutableStateOf(false) }
        var err by remember { mutableStateOf("") }
        val scope = rememberCoroutineScope()
        val errText = stringResource(R.string.server_error)
        Column(Modifier.safeDrawingPadding().padding(24.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Logo()
            Text(stringResource(R.string.server_intro))
            OutlinedTextField(value = url, onValueChange = { url = it; err = "" }, singleLine = true,
                label = { Text(stringResource(R.string.server_label)) }, modifier = Modifier.fillMaxWidth())
            if (err.isNotEmpty()) Text(err, color = MaterialTheme.colorScheme.error)
            Button(enabled = !busy, modifier = Modifier.fillMaxWidth(), onClick = {
                val u = normalise(url)
                busy = true
                scope.launch {
                    val ok = withContext(Dispatchers.IO) { reachable(u) }
                    busy = false
                    if (ok) onSave(u) else err = errText
                }
            }) { Text(stringResource(if (busy) R.string.server_checking else R.string.server_go)) }
            Text(stringResource(R.string.server_help), fontSize = 13.sp, color = Color.Gray)
        }
    }

    @Composable
    private fun Offline(onRetry: () -> Unit, onChange: () -> Unit) {
        Column(Modifier.safeDrawingPadding().padding(24.dp).fillMaxSize(), verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally) {
            Logo()
            Text(stringResource(R.string.offline), Modifier.padding(vertical = 16.dp))
            Button(onClick = onRetry) { Text(stringResource(R.string.retry)) }
            TextButton(onClick = onChange) { Text(stringResource(R.string.change_server)) }
        }
    }

    companion object {
        /** Suggested server for a new installation (it can be changed). */
        const val DEFAULT_SERVER = "https://www.meetgo.app"
        private const val MAX_SHARED_FILES = 10
        private const val MAX_SHARED_BYTES = 10L * 1024 * 1024

        fun normalise(s: String): String {
            var u = s.trim().trimEnd('/')
            if (!u.startsWith("http://") && !u.startsWith("https://")) u = "https://$u"
            return u
        }

        /** A MeetGo server answers 200 at /app/ (the web app). */
        fun reachable(base: String): Boolean = try {
            val c = URL("$base/app/").openConnection() as HttpURLConnection
            c.connectTimeout = 10000; c.readTimeout = 10000
            val ok = c.responseCode == 200
            c.disconnect(); ok
        } catch (_: Exception) { false }
    }
}
