package za.hmf.core;

import android.view.View;
import android.widget.LinearLayout;

import androidx.core.content.ContextCompat;

import org.json.JSONArray;
import org.json.JSONObject;

/** Fills the 4-part progress bar: Requested, Driver assigned, On the way, Delivered. */
public final class Steps {

    private static final String[] ORDER = {"pending", "assigned", "out_for_delivery", "delivered"};

    private Steps() { }

    public static void bind(LinearLayout bar, JSONObject delivery) {
        String status = delivery.optString("status");
        boolean failed = status.equals("failed") || status.equals("cancelled") || status.equals("returned");
        int reached = indexOf(status) + 1;

        if (failed) {
            // count how far it got before it stopped
            JSONArray history = delivery.optJSONArray("history");
            reached = 1;
            if (history != null) {
                for (int i = 0; i < history.length(); i++) {
                    JSONObject h = history.optJSONObject(i);
                    if (h != null) reached = Math.max(reached, indexOf(h.optString("status")) + 1);
                }
            }
        }

        int done = ContextCompat.getColor(bar.getContext(), failed ? R.color.core_error : R.color.core_brand);
        int todo = ContextCompat.getColor(bar.getContext(), R.color.core_line);
        for (int i = 0; i < bar.getChildCount(); i++) {
            View part = bar.getChildAt(i);
            part.setBackgroundColor(i < reached ? done : todo);
        }
    }

    private static int indexOf(String status) {
        for (int i = 0; i < ORDER.length; i++) if (ORDER[i].equals(status)) return i;
        return -1;
    }
}
