package za.hmf.patient;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import za.hmf.core.Notify;

/**
 * Remembers the last status of each delivery and shows a notification
 * when it changes (e.g. "Your medicine is on the way").
 */
public final class DeliveryUpdates {

    private static final String PREFS = "delivery_status";

    private DeliveryUpdates() { }

    /** Compare with what we saw last time; notify = false when the user is looking at the screen. */
    public static void check(Context ctx, JSONArray deliveries, boolean notify) {
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        SharedPreferences.Editor e = p.edit();
        for (int i = 0; i < deliveries.length(); i++) {
            JSONObject d = deliveries.optJSONObject(i);
            if (d == null) continue;
            String id = d.optString("delivery_id");
            String now = d.optString("status");
            String before = p.getString(id, null);
            if (notify && before != null && !before.equals(now)) show(ctx, d, now);
            e.putString(id, now);
        }
        e.apply();
    }

    private static void show(Context ctx, JSONObject d, String status) {
        String text;
        switch (status) {
            case "assigned": text = "A driver has been assigned to your delivery."; break;
            case "out_for_delivery": text = "Your medicine is on the way. Have your code ready: " + d.optString("confirmation_code"); break;
            case "delivered": text = "Your medicine has been delivered."; break;
            case "failed": text = "We couldn't deliver your medicine. The hospital will contact you."; break;
            case "cancelled": text = "Your delivery was cancelled. " + (d.isNull("failure_reason") ? "" : d.optString("failure_reason")); break;
            default: return;
        }
        Intent open = new Intent(ctx, DeliveryActivity.class).putExtra("id", d.optString("delivery_id"));
        PendingIntent pi = PendingIntent.getActivity(ctx, d.optString("delivery_id").hashCode(), open,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notify.show(ctx, d.optString("delivery_id").hashCode(), "Delivery update", text, pi);
    }
}
