package za.hmf.core;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

/** Phone notifications (e.g. "Your medicine is on the way"). */
public final class Notify {

    public static final String CHANNEL_DELIVERY = "deliveries";

    private Notify() { }

    public static void createChannels(Context ctx) {
        NotificationChannel ch = new NotificationChannel(CHANNEL_DELIVERY,
                ctx.getString(R.string.core_channel_deliveries), NotificationManager.IMPORTANCE_DEFAULT);
        ch.setDescription(ctx.getString(R.string.core_channel_deliveries_desc));
        ctx.getSystemService(NotificationManager.class).createNotificationChannel(ch);
    }

    public static void show(Context ctx, int id, String title, String text, PendingIntent onTap) {
        // Android 13+ needs the user's permission to show notifications
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            return;
        }
        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL_DELIVERY)
                .setSmallIcon(R.drawable.core_ic_notify)
                .setContentTitle(title)
                .setContentText(text)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
                .setAutoCancel(true)
                .setContentIntent(onTap);
        NotificationManagerCompat.from(ctx).notify(id, b.build());
    }
}
