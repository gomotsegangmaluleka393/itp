package za.hmf.core;

import android.content.Context;
import android.graphics.drawable.GradientDrawable;
import android.widget.TextView;

import androidx.core.content.ContextCompat;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.Locale;

/** Turns server values (dates, statuses) into text for the screen. */
public final class Fmt {

    private static final Locale ZA = new Locale("en", "ZA");
    private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("EEE, d MMM", ZA);
    private static final DateTimeFormatter DATE = DateTimeFormatter.ofPattern("d MMM yyyy", ZA);
    private static final DateTimeFormatter TIME = DateTimeFormatter.ofPattern("HH:mm", ZA);

    private Fmt() { }

    /** "2026-10-24" -> "Sat, 24 Oct" */
    public static String day(String isoDate) {
        if (isoDate == null || isoDate.isEmpty() || isoDate.equals("null")) return "";
        try {
            return LocalDate.parse(isoDate.substring(0, 10)).format(DAY);
        } catch (Exception e) {
            return isoDate;
        }
    }

    /** "2026-10-24" -> "24 Oct 2026" */
    public static String date(String isoDate) {
        if (isoDate == null || isoDate.isEmpty() || isoDate.equals("null")) return "";
        try {
            return LocalDate.parse(isoDate.substring(0, 10)).format(DATE);
        } catch (Exception e) {
            return isoDate;
        }
    }

    /** "2026-10-24T08:45:52.336Z" -> "Sat, 24 Oct, 10:45" in the phone's time zone */
    public static String dateTime(String isoTimestamp) {
        if (isoTimestamp == null || isoTimestamp.isEmpty() || isoTimestamp.equals("null")) return "";
        try {
            ZonedDateTime t = Instant.parse(isoTimestamp).atZone(ZoneId.systemDefault());
            return t.format(DAY) + ", " + t.format(TIME);
        } catch (Exception e) {
            return isoTimestamp;
        }
    }

    public static String time(String isoTimestamp) {
        if (isoTimestamp == null || isoTimestamp.isEmpty() || isoTimestamp.equals("null")) return "";
        try {
            return Instant.parse(isoTimestamp).atZone(ZoneId.systemDefault()).format(TIME);
        } catch (Exception e) {
            return isoTimestamp;
        }
    }

    /** "10:00:00" -> "10:00" */
    public static String clock(String time) {
        if (time == null || time.equals("null") || time.length() < 5) return "";
        return time.substring(0, 5);
    }

    /** JSON null comes through as the text "null"; this returns "" instead. */
    public static String str(org.json.JSONObject o, String key) {
        if (o == null || o.isNull(key)) return "";
        return o.optString(key, "");
    }

    // ---------- statuses ----------

    public static String status(String s) {
        switch (s) {
            case "pending": return "Requested";
            case "assigned": return "Driver assigned";
            case "out_for_delivery": return "On the way";
            case "delivered": return "Delivered";
            case "failed": return "Not delivered";
            case "cancelled": return "Cancelled";
            case "returned": return "Returned";
            case "active": return "Active";
            case "completed": return "Completed";
            case "expired": return "Expired";
            default: return s.replace('_', ' ');
        }
    }

    public static int statusColour(String s) {
        switch (s) {
            case "delivered": case "active": case "completed": return R.color.core_ok;
            case "out_for_delivery": return R.color.core_brand;
            case "assigned": return R.color.core_info;
            case "pending": return R.color.core_warn;
            default: return R.color.core_error;
        }
    }

    /** Makes a TextView look like a coloured status badge. */
    public static void badge(Context ctx, TextView view, String status) {
        int colour = ContextCompat.getColor(ctx, statusColour(status));
        view.setText(status(status));
        view.setTextColor(colour);
        GradientDrawable bg = new GradientDrawable();
        bg.setCornerRadius(100f);
        bg.setColor((colour & 0x00FFFFFF) | 0x22000000); // same colour, light
        view.setBackground(bg);
    }
}
