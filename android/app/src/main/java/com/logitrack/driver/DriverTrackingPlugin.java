package com.logitrack.driver;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.webkit.CookieManager;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.lang.ref.WeakReference;

/** Native GPS and HTTP continue independently of the suspended portal WebView. */
@CapacitorPlugin(name = "DriverTracking")
public class DriverTrackingPlugin extends Plugin {
    private static WeakReference<DriverTrackingPlugin> active = new WeakReference<>(null);
    private boolean visible = true;

    @Override public void load() { active = new WeakReference<>(this); }

    @PluginMethod public void start(PluginCall call) {
        if (!"com.logitrack.driver".equals(getContext().getPackageName())) {
            call.reject("Driver tracking is available only in the driver app.");
            return;
        }
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            call.reject("Allow precise location before starting driver tracking.");
            return;
        }
        if (!visible) {
            call.reject("Open the driver app to start background tracking.");
            return;
        }
        try {
            // Credentials can only go to this build's configured portal, never a URL supplied by page JavaScript.
            Uri origin = Uri.parse(getBridge().getServerUrl());
            if (origin.getHost() == null || !("https".equals(origin.getScheme()) || "http".equals(origin.getScheme()))) {
                call.reject("The driver server address is unavailable.");
                return;
            }
            String endpoint = origin.buildUpon().path("/api/driver/location").clearQuery().fragment(null).build().toString();
            String account = call.getString("driverId", "");
            String token = call.getString("token", "");
            String cookie = CookieManager.getInstance().getCookie(endpoint);
            if (account.isEmpty() || (token.isEmpty() && (cookie == null || cookie.isEmpty()))) {
                call.reject("Sign in before starting driver tracking.");
                return;
            }
            Intent intent = new Intent(getContext(), DriverTrackingService.class)
                .putExtra("endpoint", endpoint).putExtra("driverId", account)
                .putExtra("token", token).putExtra("cookie", cookie)
                .putExtra("tripId", call.getString("tripId", ""));
            ContextCompat.startForegroundService(getContext(), intent);
            call.resolve();
        } catch (Exception error) {
            call.reject("Could not start background tracking. Open the app and check location access.");
        }
    }

    @PluginMethod public void stop(PluginCall call) {
        getContext().stopService(new Intent(getContext(), DriverTrackingService.class));
        call.resolve();
    }

    @PluginMethod public void getStatus(PluginCall call) { call.resolve(DriverTrackingService.status()); }

    static void publish(String event, JSObject payload) {
        DriverTrackingPlugin plugin = active.get();
        // Do not queue thousands of JS callbacks while the WebView is asleep. Resume delivers the latest fix.
        if (plugin != null && plugin.visible) plugin.notifyListeners(event, payload);
    }

    @Override protected void handleOnPause() { visible = false; }
    @Override protected void handleOnResume() {
        visible = true;
        publish("status", DriverTrackingService.status());
    }
    @Override protected void handleOnDestroy() {
        if (active.get() == this) active.clear();
        // The service outlives activity recreation; only explicit stop/logout ends tracking.
    }
}
