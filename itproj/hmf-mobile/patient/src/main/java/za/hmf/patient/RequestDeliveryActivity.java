package za.hmf.patient;

import android.app.DatePickerDialog;
import android.os.Bundle;
import android.view.View;
import android.widget.EditText;
import android.widget.TextView;

import androidx.appcompat.app.AlertDialog;

import com.google.android.material.button.MaterialButton;

import org.json.JSONException;
import org.json.JSONObject;

import java.time.LocalDate;
import java.time.ZoneId;

import za.hmf.core.Api;
import za.hmf.core.BaseActivity;
import za.hmf.core.Fmt;

/** Address and date for a delivery. The server validates the prescription before accepting it. */
public class RequestDeliveryActivity extends BaseActivity {

    private String prescriptionId;
    private String chosenDate = null;
    private EditText address1, address2, city, postal, phone, instructions;
    private TextView error;
    private MaterialButton sendBtn, dateBtn;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_request);
        if (getSupportActionBar() != null) getSupportActionBar().setDisplayHomeAsUpEnabled(true);
        setTitle(R.string.request_delivery);

        prescriptionId = getIntent().getStringExtra("prescription_id");
        ((TextView) findViewById(R.id.medicines)).setText(getIntent().getStringExtra("medicines"));
        address1 = findViewById(R.id.address1);
        address2 = findViewById(R.id.address2);
        city = findViewById(R.id.city);
        postal = findViewById(R.id.postal);
        phone = findViewById(R.id.phone);
        instructions = findViewById(R.id.instructions);
        error = findViewById(R.id.error);
        sendBtn = findViewById(R.id.sendBtn);
        dateBtn = findViewById(R.id.dateBtn);

        dateBtn.setOnClickListener(v -> pickDate());
        sendBtn.setOnClickListener(v -> send());
        fillFromProfile();
    }

    /** Start with the address saved on the patient's profile. */
    private void fillFromProfile() {
        Api.get(this, "/api/patient/profile", new Api.Callback() {
            @Override public void onSuccess(Object r) {
                JSONObject p = (JSONObject) r;
                address1.setText(Fmt.str(p, "address_line1"));
                address2.setText(Fmt.str(p, "address_line2"));
                city.setText(Fmt.str(p, "city"));
                postal.setText(Fmt.str(p, "postal_code"));
                phone.setText(Fmt.str(p, "phone"));
            }
            @Override public void onError(int status, String message) { handleError(status, message); }
        });
    }

    private void pickDate() {
        LocalDate today = LocalDate.now(ZoneId.systemDefault());
        DatePickerDialog dlg = new DatePickerDialog(this, (view, y, m, d) -> {
            chosenDate = LocalDate.of(y, m + 1, d).toString(); // yyyy-mm-dd
            dateBtn.setText(Fmt.day(chosenDate));
        }, today.getYear(), today.getMonthValue() - 1, today.getDayOfMonth());
        dlg.getDatePicker().setMinDate(System.currentTimeMillis() - 1000);
        dlg.show();
    }

    private void send() {
        String a1 = address1.getText().toString().trim();
        String c = city.getText().toString().trim();
        if (a1.isEmpty()) { address1.setError("Enter your street address"); return; }
        if (c.isEmpty()) { city.setError("Enter your city"); return; }

        JSONObject body = new JSONObject();
        try {
            body.put("prescription_id", prescriptionId)
                .put("address_line1", a1)
                .put("address_line2", address2.getText().toString().trim())
                .put("city", c)
                .put("postal_code", postal.getText().toString().trim())
                .put("contact_phone", phone.getText().toString().trim())
                .put("delivery_instructions", instructions.getText().toString().trim());
            if (chosenDate != null) body.put("scheduled_date", chosenDate);
        } catch (JSONException ignored) { }

        sendBtn.setEnabled(false);
        error.setVisibility(View.GONE);
        Api.post(this, "/api/patient/deliveries", body, new Api.Callback() {
            @Override public void onSuccess(Object r) {
                String code = ((JSONObject) r).optString("confirmation_code");
                new AlertDialog.Builder(RequestDeliveryActivity.this)
                        .setTitle("Delivery requested")
                        .setMessage("We'll let you know when a driver is on the way.\n\nYour code for the driver is " + code
                                + ". You can always see it on the home screen.")
                        .setPositiveButton(android.R.string.ok, (d, w) -> finish())
                        .setCancelable(false)
                        .show();
            }
            @Override public void onError(int status, String message) {
                sendBtn.setEnabled(true);
                if (status == 401) { handleError(status, message); return; }
                // e.g. prescription expired or failed validation
                error.setText(message);
                error.setVisibility(View.VISIBLE);
            }
        });
    }
}
