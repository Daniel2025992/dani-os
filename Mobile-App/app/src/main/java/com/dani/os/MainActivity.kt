package com.dani.os

import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.ContentValues
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import androidx.core.content.ContextCompat
import android.webkit.WebChromeClient
import androidx.activity.result.contract.ActivityResultContracts
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.NotificationCompat

/** Hosts the DANI OS Mobile UI (assets/index.html) in a locked-down WebView. */
class MainActivity : AppCompatActivity() {
    private var chooserCb: ValueCallback<Array<Uri>>? = null
    private val picker = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        chooserCb?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(r.resultCode, r.data)); chooserCb = null
    }

    private var web: WebView? = null
    private var pendingPerm: PermissionRequest? = null
    private val camPerm = registerForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        pendingPerm?.let { if (ok) it.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE)) else it.deny() }; pendingPerm = null
    }

    /** danios://pair?c=123456 (from a QR code scanned with the system camera) */
    private fun pairUrl(i: Intent?): String? = i?.data?.takeIf { it.scheme == "danios" && it.host == "pair" }?.toString()

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        pairUrl(intent)?.let { u -> web?.evaluateJavascript("window.onPairLink&&onPairLink(" + org.json.JSONObject.quote(u) + ")", null) }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val web = WebView(this)
        this.web = web
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.allowFileAccess = false          // only our own asset URL is loaded
        web.settings.allowContentAccess = false
        web.webViewClient = WebViewClient()
        web.webChromeClient = object : WebChromeClient() {      // lets the page's <input type=file> open the system file picker
            override fun onPermissionRequest(r: PermissionRequest?) {   // camera for the QR scanner (only our own page can ask)
                if (r == null) return
                if (!r.resources.contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE)) { r.deny(); return }
                if (ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) r.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE))
                else { pendingPerm = r; camPerm.launch(Manifest.permission.CAMERA) }
            }
            override fun onShowFileChooser(w: WebView?, cb: ValueCallback<Array<Uri>>?, p: FileChooserParams?): Boolean {
                chooserCb?.onReceiveValue(null); chooserCb = cb
                return try { picker.launch(p!!.createIntent()); true } catch (e: Exception) { chooserCb = null; false }
            }
        }
        web.addJavascriptInterface(Bridge(), "Android")
        setContentView(web)
        val code = pairUrl(intent)?.let { Regex("c=(\\d{6})").find(it)?.groupValues?.get(1) }
        web.loadUrl("file:///android_asset/index.html" + (if (code != null) "#pair=$code" else ""))
    }

    inner class Bridge {
        @JavascriptInterface fun deviceName(): String = "${Build.MANUFACTURER} ${Build.MODEL}"

        /** The phone's own Wi-Fi IPv4 address (e.g. 192.168.1.23); JS scans that /24 to find the computer. */
        @JavascriptInterface fun localIp(): String = try {
            java.net.NetworkInterface.getNetworkInterfaces().toList().flatMap { it.inetAddresses.toList() }
                .firstOrNull { !it.isLoopbackAddress && it is java.net.Inet4Address && it.isSiteLocalAddress }?.hostAddress ?: ""
        } catch (e: Exception) { "" }

        /** Saves a file received from the computer into Downloads/DANI-OS. */
        @JavascriptInterface fun saveFile(name: String, base64: String): Boolean = try {
            val bytes = android.util.Base64.decode(base64, android.util.Base64.DEFAULT)
            val safe = name.replace(Regex("[\\\\/:*?\"<>|]"), "_").ifBlank { "file" }
            if (Build.VERSION.SDK_INT >= 29) {
                val v = ContentValues().apply {
                    put(MediaStore.MediaColumns.DISPLAY_NAME, safe)
                    put(MediaStore.MediaColumns.RELATIVE_PATH, "Download/DANI-OS")
                }
                val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v)!!
                contentResolver.openOutputStream(uri)!!.use { it.write(bytes) }
            } else {
                val d = java.io.File(getExternalFilesDir(null), "DANI-OS"); d.mkdirs()
                java.io.File(d, safe).writeBytes(bytes)
            }
            true
        } catch (e: Exception) { false }

        @JavascriptInterface fun notify(title: String, body: String) {
            val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
            if (Build.VERSION.SDK_INT >= 26) nm.createNotificationChannel(NotificationChannel("dani", "DANI OS", NotificationManager.IMPORTANCE_DEFAULT))
            val n = NotificationCompat.Builder(this@MainActivity, "dani")
                .setSmallIcon(android.R.drawable.stat_notify_chat).setContentTitle(title).setContentText(body).setAutoCancel(true).build()
            nm.notify(System.currentTimeMillis().toInt(), n)
        }
    }
}
