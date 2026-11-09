package com.dani.os

import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.ContentValues
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import android.webkit.ValueCallback
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

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val web = WebView(this)
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.allowFileAccess = false          // only our own asset URL is loaded
        web.settings.allowContentAccess = false
        web.webViewClient = WebViewClient()
        web.webChromeClient = object : WebChromeClient() {      // lets the page's <input type=file> open the system file picker
            override fun onShowFileChooser(w: WebView?, cb: ValueCallback<Array<Uri>>?, p: FileChooserParams?): Boolean {
                chooserCb?.onReceiveValue(null); chooserCb = cb
                return try { picker.launch(p!!.createIntent()); true } catch (e: Exception) { chooserCb = null; false }
            }
        }
        web.addJavascriptInterface(Bridge(), "Android")
        setContentView(web)
        web.loadUrl("file:///android_asset/index.html")
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
