package com.dani.os

import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.NotificationCompat

/** Hosts the DANI OS Mobile UI (assets/index.html) in a locked-down WebView. */
class MainActivity : AppCompatActivity() {
    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val web = WebView(this)
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.allowFileAccess = false          // only our own asset URL is loaded
        web.settings.allowContentAccess = false
        web.webViewClient = WebViewClient()
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

        @JavascriptInterface fun notify(title: String, body: String) {
            val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
            if (Build.VERSION.SDK_INT >= 26) nm.createNotificationChannel(NotificationChannel("dani", "DANI OS", NotificationManager.IMPORTANCE_DEFAULT))
            val n = NotificationCompat.Builder(this@MainActivity, "dani")
                .setSmallIcon(android.R.drawable.stat_notify_chat).setContentTitle(title).setContentText(body).setAutoCancel(true).build()
            nm.notify(System.currentTimeMillis().toInt(), n)
        }
    }
}
