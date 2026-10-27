package za.hmf.patient;

import android.content.Intent;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import za.hmf.core.Api;
import za.hmf.core.BaseActivity;
import za.hmf.core.Fmt;
import za.hmf.core.Steps;

/** Tracks one delivery: progress, code for the driver, driver's position and signature. */
public class DeliveryActivity extends BaseActivity {

    private static final long REFRESH_MS = 30_000;

    private String id;
    private JSONObject delivery;
    private boolean signatureLoaded = false;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable autoRefresh = this::load;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_delivery);
        if (getSupportActionBar() != null) getSupportActionBar().setDisplayHomeAsUpEnabled(true);
        setTitle("Delivery");
        id = getIntent().getStringExtra("id");

        findViewById(R.id.mapBtn).setOnClickListener(v -> openMap());
        findViewById(R.id.cancelBtn).setOnClickListener(v ->
                confirm("Cancel delivery", "Do you want to cancel this delivery?", this::cancelDelivery));
    }

    @Override
    protected void onResume() {
        super.onResume();
        load();
    }

    @Override
    protected void onPause() {
        super.onPause();
        handler.removeCallbacks(autoRefresh);
    }

    private void load() {
        handler.removeCallbacks(autoRefresh);
        Api.get(this, "/api/patient/deliveries", new Api.Callback() {
            @Override public void onSuccess(Object r) {
                JSONArray rows = (JSONArray) r;
                for (int i = 0; i < rows.length(); i++) {
                    if (id.equals(rows.optJSONObject(i).optString("delivery_id"))) delivery = rows.optJSONObject(i);
                }
                if (delivery == null) { toast("Delivery not found"); finish(); return; }
                DeliveryUpdates.check(DeliveryActivity.this, rows, false);
                show();
            }
            @Override public void onError(int status, String message) { handleError(status, message); }
        });
    }

    private void show() {
        JSONObject d = delivery;
        String status = d.optString("status");
        String date = Fmt.day(Fmt.str(d, "scheduled_date"));

        ((TextView) findViewById(R.id.title)).setText(date.isEmpty() ? "Delivery" : date);
        Fmt.badge(this, findViewById(R.id.badge), status);
        ((TextView) findViewById(R.id.medicines)).setText(Fmt.str(d, "medicines"));
        Steps.bind(findViewById(R.id.stepsBar), d);

        // code
        String code = Fmt.str(d, "confirmation_code");
        findViewById(R.id.codeBox).setVisibility(code.isEmpty() ? View.GONE : View.VISIBLE);
        ((TextView) findViewById(R.id.code)).setText(code);

        // driver position
        boolean hasPosition = !Fmt.str(d, "driver_lat").isEmpty();
        findViewById(R.id.mapBox).setVisibility(hasPosition ? View.VISIBLE : View.GONE);
        ((TextView) findViewById(R.id.mapTime)).setText("Updated " + Fmt.time(Fmt.str(d, "driver_location_at")));

        // details
        LinearLayout details = findViewById(R.id.details);
        details.removeAllViews();
        StringBuilder addr = new StringBuilder(Fmt.str(d, "address_line1"));
        if (!Fmt.str(d, "address_line2").isEmpty()) addr.append(", ").append(Fmt.str(d, "address_line2"));
        addr.append(", ").append(Fmt.str(d, "city"));
        addRow(details, "Address", addr.toString());
        String win = Fmt.clock(Fmt.str(d, "scheduled_window_start"));
        if (!win.isEmpty()) addRow(details, "Time window", win + " – " + Fmt.clock(Fmt.str(d, "scheduled_window_end")));
        addRow(details, "Driver", Fmt.str(d, "driver_name"));
        if (status.equals("delivered")) {
            addRow(details, "Delivered", Fmt.dateTime(Fmt.str(d, "delivered_at")) + " to " + Fmt.str(d, "recipient_name"));
        }
        addRow(details, "Note", Fmt.str(d, "failure_reason"));

        // history
        LinearLayout history = findViewById(R.id.history);
        while (history.getChildCount() > 1) history.removeViewAt(1);
        JSONArray h = d.optJSONArray("history");
        if (h != null) {
            for (int i = h.length() - 1; i >= 0; i--) {
                JSONObject e = h.optJSONObject(i);
                addRow(history, Fmt.dateTime(Fmt.str(e, "at")), Fmt.status(e.optString("status")));
            }
        }

        // signature (proof of delivery)
        if (d.optBoolean("has_signature") && !signatureLoaded) loadSignature();

        findViewById(R.id.cancelBtn).setVisibility(status.equals("pending") || status.equals("assigned") ? View.VISIBLE : View.GONE);

        if (status.equals("assigned") || status.equals("out_for_delivery")) handler.postDelayed(autoRefresh, REFRESH_MS);
    }

    private void addRow(LinearLayout parent, String label, String value) {
        if (value == null || value.trim().isEmpty()) return;
        TextView l = new TextView(this);
        l.setTextAppearance(R.style.Hmf_Label);
        l.setText(label);
        l.setPadding(0, 12, 0, 0);
        TextView v = new TextView(this);
        v.setTextAppearance(R.style.Hmf_Body);
        v.setText(value);
        parent.addView(l);
        parent.addView(v);
    }

    private void openMap() {
        String q = Fmt.str(delivery, "driver_lat") + "," + Fmt.str(delivery, "driver_lng");
        startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("geo:" + q + "?q=" + q + "(Your driver)")));
    }

    private void loadSignature() {
        Api.getBytes(this, "/api/patient/deliveries/" + id + "/proof", (bytes, error) -> {
            if (bytes == null) return;
            ImageView img = findViewById(R.id.signature);
            img.setImageBitmap(BitmapFactory.decodeByteArray(bytes, 0, bytes.length));
            img.setVisibility(View.VISIBLE);
            signatureLoaded = true;
        });
    }

    private void cancelDelivery() {
        Api.patch(this, "/api/patient/deliveries/" + id + "/cancel", null, new Api.Callback() {
            @Override public void onSuccess(Object r) { toast("Delivery cancelled"); load(); }
            @Override public void onError(int status, String message) { handleError(status, message); }
        });
    }
}
