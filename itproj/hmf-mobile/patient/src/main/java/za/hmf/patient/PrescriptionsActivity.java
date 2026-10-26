package za.hmf.patient;

import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.widget.TextView;

import androidx.core.content.ContextCompat;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

import com.google.android.material.button.MaterialButton;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.HashSet;
import java.util.Set;

import za.hmf.core.Api;
import za.hmf.core.BaseActivity;
import za.hmf.core.Fmt;
import za.hmf.core.JsonAdapter;

/** The patient's prescriptions, with "Request delivery" and "Reorder" for refills. */
public class PrescriptionsActivity extends BaseActivity {

    private JsonAdapter adapter;
    private SwipeRefreshLayout refresh;
    private TextView empty;
    private final Set<String> onTheWay = new HashSet<>(); // prescriptions with an open delivery

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_list);
        if (getSupportActionBar() != null) getSupportActionBar().setDisplayHomeAsUpEnabled(true);
        setTitle(R.string.prescriptions);

        refresh = findViewById(R.id.refresh);
        empty = findViewById(R.id.empty);
        empty.setText(R.string.no_prescriptions);
        adapter = new JsonAdapter(R.layout.item_prescription, this::bindRow, null);
        RecyclerView list = findViewById(R.id.list);
        list.setLayoutManager(new LinearLayoutManager(this));
        list.setAdapter(adapter);
        refresh.setOnRefreshListener(this::load);
    }

    @Override
    protected void onResume() {
        super.onResume();
        load();
    }

    private void load() {
        refresh.setRefreshing(true);
        // first see which prescriptions already have a delivery on the way
        Api.get(this, "/api/patient/deliveries", new Api.Callback() {
            @Override public void onSuccess(Object r) {
                onTheWay.clear();
                JSONArray rows = (JSONArray) r;
                for (int i = 0; i < rows.length(); i++) {
                    JSONObject d = rows.optJSONObject(i);
                    String s = d.optString("status");
                    if (s.equals("pending") || s.equals("assigned") || s.equals("out_for_delivery")) onTheWay.add(d.optString("prescription_id"));
                }
                loadPrescriptions();
            }
            @Override public void onError(int status, String message) {
                refresh.setRefreshing(false);
                handleError(status, message);
            }
        });
    }

    private void loadPrescriptions() {
        Api.get(this, "/api/patient/prescriptions", new Api.Callback() {
            @Override public void onSuccess(Object r) {
                refresh.setRefreshing(false);
                JSONArray rows = (JSONArray) r;
                adapter.setItems(rows);
                empty.setVisibility(rows.length() == 0 ? View.VISIBLE : View.GONE);
            }
            @Override public void onError(int status, String message) {
                refresh.setRefreshing(false);
                handleError(status, message);
            }
        });
    }

    private void bindRow(View row, JSONObject rx, int position) {
        String status = rx.optString("status");
        int daysLeft = rx.optInt("days_left");

        ((TextView) row.findViewById(R.id.rxTitle)).setText("Dr " + Fmt.str(rx, "doctor_name"));
        Fmt.badge(this, row.findViewById(R.id.rxBadge), status);

        TextView valid = row.findViewById(R.id.rxValid);
        valid.setText("Issued " + Fmt.date(Fmt.str(rx, "issue_date")) + " · valid until " + Fmt.date(Fmt.str(rx, "expiry_date"))
                + (status.equals("active") && daysLeft <= 7 ? " (" + daysLeft + " days left)" : ""));
        valid.setTextColor(ContextCompat.getColor(this, status.equals("active") && daysLeft <= 7 ? za.hmf.core.R.color.core_warn : za.hmf.core.R.color.core_muted));

        boolean expired = rx.optBoolean("is_expired");

        // medicines
        StringBuilder meds = new StringBuilder();
        JSONArray items = rx.optJSONArray("items");
        String names = "";
        if (items != null) {
            for (int i = 0; i < items.length(); i++) {
                JSONObject it = items.optJSONObject(i);
                if (i > 0) { meds.append("\n"); names += ", "; }
                meds.append("• ").append(it.optString("medication")).append(" – ").append(it.optString("dosage"))
                        .append(", ").append(it.optString("frequency"));
                if (!Fmt.str(it, "instructions").isEmpty()) meds.append(" (").append(it.optString("instructions")).append(")");
                names += it.optString("medication");
            }
        }
        ((TextView) row.findViewById(R.id.rxItems)).setText(meds.toString());

        // delivery / reorder
        MaterialButton action = row.findViewById(R.id.rxAction);
        TextView note = row.findViewById(R.id.rxNote);
        int allowed = rx.optInt("times_allowed", 1);
        int used = rx.optInt("times_dispensed", 0);
        String id = rx.optString("prescription_id");
        final String medNames = names;

        note.setVisibility(View.GONE);
        action.setVisibility(View.VISIBLE);
        action.setEnabled(true);
        if (expired) {
            // kept for the record, but a new prescription is needed
            action.setVisibility(View.GONE);
            note.setText(Fmt.str(rx, "renewed_by").isEmpty()
                    ? "Expired on " + Fmt.date(Fmt.str(rx, "expiry_date")) + ". It can't be used or delivered any more – ask your doctor for a new prescription."
                    : "Your doctor has issued a new prescription to replace this one.");
            note.setVisibility(View.VISIBLE);
        } else if (!status.equals("active")) {
            action.setVisibility(View.GONE);
        } else if (onTheWay.contains(id)) {
            action.setText("Delivery on the way – track it");
            action.setOnClickListener(v -> finish()); // deliveries are on the home screen
        } else if (used >= allowed) {
            action.setVisibility(View.GONE);
            note.setText("All refills used. Book a follow-up for a new prescription.");
            note.setVisibility(View.VISIBLE);
        } else {
            action.setText(used > 0 ? "Reorder (" + (allowed - used) + " left)" : getString(R.string.request_delivery));
            action.setOnClickListener(v -> startActivity(new Intent(this, RequestDeliveryActivity.class)
                    .putExtra("prescription_id", id).putExtra("medicines", medNames)));
        }
    }
}
