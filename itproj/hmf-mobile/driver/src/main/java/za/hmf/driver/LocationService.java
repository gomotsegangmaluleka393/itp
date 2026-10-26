package za.hmf.driver;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.IBinder;
import android.os.Looper;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

import za.hmf.core.Api;

/**
 * Sends the driver's GPS position to the server while a delivery is on the way,
 * so the patient can follow it. Shows a notification the whole time (Android requires this).
 */
public class LocationService extends Service implements LocationListener {

    private static final String CHANNEL = "tracking";
    private static final int NOTIFICATION_ID = 77;
    private static final long EVERY_MS = 30_000;   // at most every 30 seconds
    private static final float EVERY_METRES = 25f;  // or after moving 25 m

    // deliveries currently out for delivery
    private static final Set<String> ACTIVE = ConcurrentHashMap.newKeySet();

    private LocationManager locations;
    private long lastSent = 0;

    // ---------- start and stop from screens ----------

    public static void start(Context ctx, String deliveryId) {
        ACTIVE.add(deliveryId);
        ContextCompat.startForegroundService(ctx, new Intent(ctx, LocationService.class));
    }

    public static void stop(Context ctx, String deliveryId) {
        ACTIVE.remove(deliveryId);
        if (ACTIVE.isEmpty()) ctx.stopService(new Intent(ctx, LocationService.class));
    }

    public static void stopAll(Context ctx) {
        ACTIVE.clear();
        ctx.stopService(new Intent(ctx, LocationService.class));
    }

    // ---------- service ----------

    @Override
    public void onCreate() {
        super.onCreate();
        NotificationChannel ch = new NotificationChannel(CHANNEL, getString(R.string.tracking_channel), NotificationManager.IMPORTANCE_LOW);
        getSystemService(NotificationManager.class).createNotificationChannel(ch);

        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE);
        Notification n = new NotificationCompat.Builder(this, CHANNEL)
                .setSmallIcon(za.hmf.core.R.drawable.core_ic_notify)
                .setContentTitle(getString(R.string.tracking_title))
                .setContentText(getString(R.string.tracking_text))
                .setOngoing(true)
                .setContentIntent(open)
                .build();
        ServiceCompat.startForeground(this, NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);

        locations = getSystemService(LocationManager.class);
        try {
            if (locations.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                locations.requestLocationUpdates(LocationManager.GPS_PROVIDER, EVERY_MS, EVERY_METRES, this, Looper.getMainLooper());
            }
            if (locations.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                locations.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, EVERY_MS, EVERY_METRES, this, Looper.getMainLooper());
            }
        } catch (SecurityException e) {
            // permission was taken away
            stopSelf();
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (ACTIVE.isEmpty()) stopSelf();
        return START_NOT_STICKY;
    }

    @Override
    public void onLocationChanged(@NonNull Location loc) {
        long now = System.currentTimeMillis();
        if (now - lastSent < EVERY_MS / 2) return; // GPS and network can both fire
        lastSent = now;

        for (String id : ACTIVE) {
            JSONObject body = new JSONObject();
            try {
                body.put("lat", loc.getLatitude()).put("lng", loc.getLongitude());
            } catch (JSONException ignored) { }
            Api.post(this, "/api/driver/deliveries/" + id + "/location", body, new Api.Callback() {
                @Override public void onSuccess(Object r) { }
                @Override public void onError(int status, String message) {
                    // 400 = no longer out for delivery, 401 = logged out
                    if (status == 400 || status == 401 || status == 404) stop(LocationService.this, id);
                }
            });
        }
    }

    // Needed on Android 8-10, where these have no default code
    @Override public void onStatusChanged(String provider, int status, android.os.Bundle extras) { }
    @Override public void onProviderEnabled(@NonNull String provider) { }
    @Override public void onProviderDisabled(@NonNull String provider) { }

    @Override
    public void onDestroy() {
        if (locations != null) locations.removeUpdates(this);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
