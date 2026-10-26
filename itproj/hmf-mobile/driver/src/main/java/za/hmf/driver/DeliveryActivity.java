package za.hmf.driver;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AlertDialog;

import com.google.android.material.button.MaterialButton;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import za.hmf.core.Api;
import za.hmf.core.BaseActivity;
import za.hmf.core.Fmt;

/** One delivery: navigate, call, start, complete or report a problem. */
public class DeliveryActivity extends BaseActivity {

    private static final int LOCATION_REQUEST = 10;

    private String id;
    private JSONObject delivery;
    private MaterialButton mainBtn, failBtn;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_delivery);
        if (getSupportActionBar() != null) getSupportActionBar().setDisplayHomeAsUpEnabled(true);
        setTitle("Delivery");

        id = getIntent().getStringExtra("id");
        mainBtn = findViewById(R.id.mainBtn);
        failBtn = findViewById(R.id.failBtn);

        findViewById(R.id.navigateBtn).setOnClickListener(v -> navigate());
        findViewById(R.id.callBtn).setOnClickListener(v -> call());
        failBtn.setOnClickListener(v -> askWhyFailed());
    }

    @Override
    protected void onResume() {
        super.onResume();
        load();
    }

    private void load() {
        Api.get(this, "/api/driver/deliveries/" + id, new Api.Callback() {
            @Override public void onSuccess(Object r) {
                delivery = (JSONObject) r;
                show();
            }
            @Override public void onError(int status, String message) {
                handleError(status, message);
                if (status == 404) finish();
            }
        });
    }

    private void show() {
        JSONObject d = delivery;
        String status = d.optString("status");

        ((TextView) findViewById(R.id.patient)).setText(Fmt.str(d, "patient_name"));
        Fmt.badge(this, findViewById(R.id.badge), status);
        ((TextView) findViewById(R.id.address)).setText(MainActivity.address(d));
        findViewById(R.id.callBtn).setVisibility(Fmt.str(d, "contact_phone").isEmpty() ? View.GONE : View.VISIBLE);
        findViewById(R.id.idWarning).setVisibility(d.optBoolean("id_check_required") ? View.VISIBLE : View.GONE);

        // details
        LinearLayout details = findViewById(R.id.details);
        details.removeAllViews();
        String win = Fmt.clock(Fmt.str(d, "scheduled_window_start"));
        addRow(details, getString(R.string.window), Fmt.day(Fmt.str(d, "scheduled_date"))
                + (win.isEmpty() ? "" : "  " + win + "–" + Fmt.clock(Fmt.str(d, "scheduled_window_end"))));
        addRow(details, getString(R.string.items), d.optInt("item_count") + " medicine(s), sealed by the pharmacy");
        addRow(details, getString(R.string.instructions), Fmt.str(d, "delivery_instructions"));
        addRow(details, getString(R.string.vehicle), (Fmt.str(d, "plate_number") + " " + Fmt.str(d, "make_model")).trim());
        if (!Fmt.str(d, "failure_reason").isEmpty()) addRow(details, "Problem", Fmt.str(d, "failure_reason"));
        if (!Fmt.str(d, "recipient_name").isEmpty()) addRow(details, "Received by", Fmt.str(d, "recipient_name"));

        // history
        LinearLayout history = findViewById(R.id.history);
        while (history.getChildCount() > 1) history.removeViewAt(1);
        JSONArray h = d.optJSONArray("history");
        if (h != null) {
            for (int i = h.length() - 1; i >= 0; i--) {
                JSONObject e = h.optJSONObject(i);
                String note = Fmt.str(e, "notes");
                addRow(history, Fmt.dateTime(Fmt.str(e, "at")), Fmt.status(e.optString("status")) + (note.isEmpty() ? "" : " – " + note));
            }
        }

        // the next step
        failBtn.setVisibility(status.equals("assigned") || status.equals("out_for_delivery") ? View.VISIBLE : View.GONE);
        mainBtn.setVisibility(View.VISIBLE);
        mainBtn.setEnabled(true);
        switch (status) {
            case "assigned":
                mainBtn.setText(R.string.start_delivery);
                mainBtn.setOnClickListener(v -> startDelivery());
                break;
            case "out_for_delivery":
                mainBtn.setText(R.string.complete_delivery);
                mainBtn.setOnClickListener(v -> startActivity(new Intent(this, CompleteActivity.class)
                        .putExtra("id", id)
                        .putExtra("patient", Fmt.str(d, "patient_name"))
                        .putExtra("id_check", d.optBoolean("id_check_required"))));
                // keep sharing location if the app was closed and opened again
                if (hasLocation()) LocationService.start(this, id);
                break;
            default:
                mainBtn.setVisibility(View.GONE);
        }
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

    // ---------- actions ----------

    private void navigate() {
        String place = MainActivity.address(delivery) + ", " + Fmt.str(delivery, "country");
        Intent maps = new Intent(Intent.ACTION_VIEW, Uri.parse("google.navigation:q=" + Uri.encode(place)));
        maps.setPackage("com.google.android.apps.maps");
        if (maps.resolveActivity(getPackageManager()) == null) {
            // no Google Maps: use any maps app
            maps = new Intent(Intent.ACTION_VIEW, Uri.parse("geo:0,0?q=" + Uri.encode(place)));
        }
        startActivity(maps);
    }

    private void call() {
        startActivity(new Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + Fmt.str(delivery, "contact_phone"))));
    }

    private void startDelivery() {
        // location is needed so the patient can follow the delivery
        if (!hasLocation()) {
            requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, LOCATION_REQUEST);
            return;
        }
        mainBtn.setEnabled(false);
        Api.post(this, "/api/driver/deliveries/" + id + "/start", null, new Api.Callback() {
            @Override public void onSuccess(Object r) {
                LocationService.start(DeliveryActivity.this, id);
                toast("Delivery started. Drive safely!");
                load();
            }
            @Override public void onError(int status, String message) {
                mainBtn.setEnabled(true);
                // e.g. the prescription expired or failed validation
                new AlertDialog.Builder(DeliveryActivity.this).setTitle("Can't start").setMessage(message)
                        .setPositiveButton(android.R.string.ok, null).show();
                if (status == 401) handleError(status, message);
            }
        });
    }

    private boolean hasLocation() {
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    @Override
    public void onRequestPermissionsResult(int code, @NonNull String[] permissions, @NonNull int[] results) {
        super.onRequestPermissionsResult(code, permissions, results);
        if (code != LOCATION_REQUEST) return;
        if (hasLocation()) startDelivery();
        else toast(getString(R.string.need_location));
    }

    private void askWhyFailed() {
        EditText reason = new EditText(this);
        reason.setHint(R.string.fail_hint);
        int pad = (int) (20 * getResources().getDisplayMetrics().density);
        reason.setPadding(pad, pad / 2, pad, pad / 2);

        new AlertDialog.Builder(this)
                .setTitle(R.string.fail_title)
                .setView(reason)
                .setPositiveButton(R.string.save, (dlg, w) -> {
                    String text = reason.getText().toString().trim();
                    if (text.isEmpty()) { toast("Please give a reason"); return; }
                    JSONObject body = new JSONObject();
                    try { body.put("reason", text); } catch (JSONException ignored) { }
                    Api.post(this, "/api/driver/deliveries/" + id + "/fail", body, new Api.Callback() {
                        @Override public void onSuccess(Object r) {
                            LocationService.stop(DeliveryActivity.this, id);
                            toast("Saved. The hospital has been told.");
                            load();
                        }
                        @Override public void onError(int status, String message) { handleError(status, message); }
                    });
                })
                .setNegativeButton(R.string.core_cancel, null)
                .show();
    }
}
