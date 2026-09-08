package com.logitrack.driver;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import org.json.JSONObject;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/** Foreground location service: GPS acquisition and uploads never depend on JavaScript timers. */
public class DriverTrackingService extends Service implements LocationListener {
    private static final String CHANNEL = "driver-live-location";
    private static volatile boolean running;
    private static volatile JSObject latest;
    private static volatile String driverId = "";
    private static volatile String lastError;
    private final ScheduledExecutorService uploads = Executors.newSingleThreadScheduledExecutor();
    private LocationManager manager;
    private PowerManager.WakeLock trackingWakeLock;
    private long wakeRenewedAt;
    private volatile JSObject pending;
    // One immutable session snapshot prevents an in-flight upload from mixing old GPS with new credentials.
    private static final class Session {
        final String endpoint, token, cookie, tripId, driver;
        Session(Intent intent, String driver) {
            endpoint = intent.getStringExtra("endpoint"); token = intent.getStringExtra("token");
            cookie = intent.getStringExtra("cookie"); tripId = intent.getStringExtra("tripId"); this.driver = driver;
        }
    }
    private volatile Session session;
    private volatile boolean stopped;
    private volatile long configurationVersion;
    private long lastFixTime;
    private long retryAt;
    private int failures;

    /** Keep the response small; it is only used to explain a rejected upload in the status card. */
    private static String readResponse(java.io.InputStream stream) throws java.io.IOException {
        if (stream == null) return "";
        try (java.io.InputStream input = stream;
             java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream()) {
            byte[] buffer = new byte[1024];
            int length;
            while ((length = input.read(buffer)) != -1 && bytes.size() < 4096) {
                bytes.write(buffer, 0, Math.min(length, 4096 - bytes.size()));
            }
            return new String(bytes.toByteArray(), StandardCharsets.UTF_8).trim();
        }
    }

    private static String responseDetail(String responseBody) {
        if (responseBody == null || responseBody.isEmpty()) return "";
        try {
            String detail = new JSONObject(responseBody).optString("error", "").trim();
            if (!detail.isEmpty()) return detail;
        } catch (Exception ignored) {
            // Some proxies return a short HTML/text error page. Use it only when it is safe and useful.
        }
        String compact = responseBody.replaceAll("\\s+", " ").trim();
        return compact.length() > 160 ? compact.substring(0, 160) : compact;
    }

    private static final class UploadRejectedException extends java.io.IOException {
        final int statusCode;
        final String detail;

        UploadRejectedException(int statusCode, String detail) {
            super("Location upload rejected");
            this.statusCode = statusCode;
            this.detail = detail;
        }
    }

    static JSObject status() {
        JSObject value = new JSObject();
        value.put("running", running);
        value.put("driverId", driverId);
        value.put("location", latest == null ? JSONObject.NULL : latest);
        value.put("error", lastError == null ? JSONObject.NULL : lastError);
        return value;
    }

    @Override public void onCreate() {
        super.onCreate();
        manager = (LocationManager) getSystemService(LOCATION_SERVICE);
        // Keep GPS/HTTP work alive with the screen off, only for this explicitly active tracking service.
        trackingWakeLock = ((PowerManager) getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "AAB:DriverTracking");
        trackingWakeLock.setReferenceCounted(false);
        trackingWakeLock.acquire(600000);
        wakeRenewedAt = SystemClock.elapsedRealtime();
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(CHANNEL, "Driver location tracking", NotificationManager.IMPORTANCE_LOW);
            getSystemService(NotificationManager.class).createNotificationChannel(channel);
        }
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification notification = new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation).setContentTitle("Delivery location tracking")
            .setContentText("Your location is shared while your trip is active.").setOngoing(true)
            .setContentIntent(open).build();
        if (Build.VERSION.SDK_INT >= 29) startForeground(2029, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
        else startForeground(2029, notification);
        uploads.scheduleWithFixedDelay(this::uploadLatest, 0, 1, TimeUnit.SECONDS);
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) { stopSelf(); return START_NOT_STICKY; }
        String account = intent.getStringExtra("driverId");
        // Never carry a location or an upload into another driver's session.
        if (account == null || account.isEmpty()) { stopSelf(); return START_NOT_STICKY; }
        if (!account.equals(driverId)) { pending = null; latest = null; lastFixTime = 0; }
        driverId = account;
        session = new Session(intent, account);
        configurationVersion++;
        lastError = null;
        retryAt = 0;
        if (!running) {
            try {
                if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                    fail("Precise location permission was revoked.");
                    stopSelf();
                    return START_NOT_STICKY;
                }
                // GPS is primary; a network fix can fill gaps only if it passes the same accuracy gate.
                if (manager.getAllProviders().contains(LocationManager.GPS_PROVIDER)) {
                    manager.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000, 0, this, Looper.getMainLooper());
                }
                if (manager.getAllProviders().contains(LocationManager.NETWORK_PROVIDER)) {
                    manager.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 1000, 0, this, Looper.getMainLooper());
                }
                running = true;
            } catch (Exception error) {
                fail("Location tracking could not start. Check GPS and location permission.");
                stopSelf();
            }
        }
        DriverTrackingPlugin.publish("status", status());
        // Credentials live in memory only. OS force-stop/reboot requires opening the app again.
        return START_NOT_STICKY;
    }

    @Override public void onLocationChanged(Location location) {
        if (stopped || !location.hasAccuracy() || location.getAccuracy() > 100 || location.getAccuracy() < 0) return;
        if (location.getTime() <= lastFixTime || System.currentTimeMillis() - location.getTime() > 30000) return;
        lastFixTime = location.getTime();
        JSObject fix = new JSObject();
        fix.put("driverId", driverId);
        fix.put("lat", location.getLatitude());
        fix.put("lng", location.getLongitude());
        fix.put("accuracy", location.getAccuracy());
        fix.put("heading", location.hasBearing() ? location.getBearing() : JSONObject.NULL);
        fix.put("speed", location.hasSpeed() ? location.getSpeed() : JSONObject.NULL);
        fix.put("recordedAt", location.getTime());
        latest = fix;
        pending = fix;
        DriverTrackingPlugin.publish("location", fix);
    }

    private void uploadLatest() {
        if (!stopped && SystemClock.elapsedRealtime() - wakeRenewedAt > 300000) {
            trackingWakeLock.acquire(600000);
            wakeRenewedAt = SystemClock.elapsedRealtime();
        }
        JSObject fix = pending;
        Session sendingSession = session;
        if (stopped || fix == null || sendingSession == null || sendingSession.endpoint == null || System.currentTimeMillis() < retryAt) return;
        if (!sendingSession.driver.equals(fix.optString("driverId"))) return;
        long version = configurationVersion;
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(sendingSession.endpoint).openConnection();
            // Follow an origin redirect (for example apex -> www) so the background
            // service uses the same API endpoint as the foreground WebView.
            connection.setInstanceFollowRedirects(true);
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(10000);
            connection.setReadTimeout(10000);
            connection.setDoOutput(true);
            connection.setUseCaches(false);
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setRequestProperty("Accept", "application/json");
            if (sendingSession.token != null && !sendingSession.token.isEmpty()) connection.setRequestProperty("Authorization", "Bearer " + sendingSession.token);
            if (sendingSession.cookie != null && !sendingSession.cookie.isEmpty()) connection.setRequestProperty("Cookie", sendingSession.cookie);
            JSObject body = new JSObject();
            body.put("latitude", fix.get("lat")); body.put("longitude", fix.get("lng"));
            body.put("accuracy", fix.get("accuracy")); body.put("heading", fix.get("heading"));
            body.put("speed", fix.get("speed")); body.put("tripId", sendingSession.tripId == null || sendingSession.tripId.isEmpty() ? JSONObject.NULL : sendingSession.tripId);
            body.put("recordedAt", fix.get("recordedAt"));
            byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
            connection.setFixedLengthStreamingMode(bytes.length);
            try (java.io.OutputStream output = connection.getOutputStream()) { output.write(bytes); }
            int code = connection.getResponseCode();
            if (version != configurationVersion || stopped) return;
            if (code >= 200 && code < 300) {
                // A proxy or an older backend may return an empty 2xx body. The upload
                // is still accepted; only inspect JSON when the body is present.
                String responseBody = readResponse(connection.getInputStream());
                if (!responseBody.isEmpty()) {
                    try {
                        JSONObject response = new JSONObject(responseBody);
                        // A trip completed elsewhere must stop sharing even while the WebView is asleep.
                        if (response.has("trackingAllowed") && !response.optBoolean("trackingAllowed")) {
                            stopSelf();
                            return;
                        }
                    } catch (Exception ignored) {
                        // A successful upload does not become a failure because a proxy
                        // wrapped the JSON in an unexpected response format.
                    }
                }
                if (pending == fix) pending = null;
                failures = 0;
                // Tell the resumed WebView when a previously failed upload has recovered,
                // so it can dismiss the stale retry toast immediately.
                boolean recovered = lastError != null;
                lastError = null;
                if (recovered) DriverTrackingPlugin.publish("status", status());
            } else if (code == 401 || code == 403) {
                fail("Sign in again to continue sharing your location.");
                stopSelf();
            } else {
                String detail = responseDetail(readResponse(connection.getErrorStream()));
                // A malformed sample cannot be fixed by retrying the same payload. Drop
                // only that sample and let the next GPS fix be uploaded normally.
                if (code >= 400 && code < 500 && code != 429) {
                    if (pending == fix) pending = null;
                    failures = 0;
                    retryAt = 0;
                    fail(String.format(Locale.US, "Location upload rejected (%d)%s.", code,
                        detail.isEmpty() ? "" : ": " + detail));
                } else {
                    throw new UploadRejectedException(code, detail);
                }
            }
        } catch (Exception error) {
            if (!stopped && version == configurationVersion) {
                // Latest-only retry matches the server's latest-location contract and cannot replay old positions.
                retryAt = System.currentTimeMillis() + Math.min(30000, 1000L << Math.min(++failures, 5));
                if (error instanceof UploadRejectedException rejected && rejected.statusCode >= 500) {
                    fail(String.format(Locale.US, "Location upload interrupted (%d). Retrying automatically.", rejected.statusCode));
                } else {
                    fail("Location upload interrupted. Retrying automatically.");
                }
            }
        } finally { if (connection != null) connection.disconnect(); }
    }

    private void fail(String message) { lastError = message; DriverTrackingPlugin.publish("status", status()); }
    @Override public void onProviderDisabled(String provider) { fail("Location services are disabled. Enable GPS to continue tracking."); }
    @Override public void onProviderEnabled(String provider) { lastError = null; DriverTrackingPlugin.publish("status", status()); }
    @Override public void onStatusChanged(String provider, int status, Bundle extras) { }
    @Override public IBinder onBind(Intent intent) { return null; }
    @Override public void onDestroy() {
        stopped = true;
        running = false;
        configurationVersion++;
        manager.removeUpdates(this);
        uploads.shutdownNow();
        if (trackingWakeLock != null && trackingWakeLock.isHeld()) trackingWakeLock.release();
        pending = null; latest = null; session = null; driverId = "";
        stopForeground(true);
        DriverTrackingPlugin.publish("status", status());
        super.onDestroy();
    }
}
