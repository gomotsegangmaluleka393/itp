package za.hmf.driver;

import android.os.Bundle;
import android.util.Base64;
import android.view.View;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.TextView;

import androidx.appcompat.app.AlertDialog;

import com.google.android.material.button.MaterialButton;

import org.json.JSONException;
import org.json.JSONObject;

import za.hmf.core.Api;
import za.hmf.core.BaseActivity;

/**
 * Proof of delivery: the patient's 4-digit code, the name of the person receiving it,
 * their signature, and an ID check for controlled medicines.
 */
public class CompleteActivity extends BaseActivity {

    private String id;
    private boolean idCheck;
    private EditText code, recipient;
    private CheckBox idChecked;
    private SignatureView signature;
    private MaterialButton confirmBtn;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_complete);
        if (getSupportActionBar() != null) getSupportActionBar().setDisplayHomeAsUpEnabled(true);
        setTitle(R.string.complete_delivery);

        id = getIntent().getStringExtra("id");
        idCheck = getIntent().getBooleanExtra("id_check", false);

        ((TextView) findViewById(R.id.title)).setText("Handing over to " + getIntent().getStringExtra("patient"));
        code = findViewById(R.id.code);
        recipient = findViewById(R.id.recipient);
        idChecked = findViewById(R.id.idChecked);
        signature = findViewById(R.id.signature);
        confirmBtn = findViewById(R.id.confirmBtn);

        idChecked.setVisibility(idCheck ? View.VISIBLE : View.GONE);
        findViewById(R.id.clearBtn).setOnClickListener(v -> signature.clear());
        confirmBtn.setOnClickListener(v -> submit());
    }

    private void submit() {
        String c = code.getText().toString().trim();
        String name = recipient.getText().toString().trim();

        if (c.length() != 4) { code.setError("Ask the patient for their 4-digit code"); return; }
        if (name.isEmpty()) { recipient.setError("Enter the name of the person receiving it"); return; }
        if (idCheck && !idChecked.isChecked()) { toast("Check the patient's ID first"); return; }
        if (!signature.isSigned()) { toast("Ask the person to sign"); return; }

        JSONObject body = new JSONObject();
        try {
            body.put("confirmation_code", c)
                .put("recipient_name", name)
                .put("id_checked", idChecked.isChecked())
                .put("signature_png", Base64.encodeToString(signature.toPng(), Base64.NO_WRAP));
        } catch (JSONException ignored) { }

        confirmBtn.setEnabled(false);
        Api.post(this, "/api/driver/deliveries/" + id + "/deliver", body, new Api.Callback() {
            @Override public void onSuccess(Object r) {
                LocationService.stop(CompleteActivity.this, id);
                new AlertDialog.Builder(CompleteActivity.this)
                        .setTitle("Delivered")
                        .setMessage("Thank you. The delivery is complete and the patient has been notified.")
                        .setPositiveButton(android.R.string.ok, (d, w) -> finish())
                        .setCancelable(false)
                        .show();
            }

            @Override public void onError(int status, String message) {
                confirmBtn.setEnabled(true);
                if (status == 401) { handleError(status, message); return; }
                new AlertDialog.Builder(CompleteActivity.this).setTitle("Not completed").setMessage(message)
                        .setPositiveButton(android.R.string.ok, null).show();
            }
        });
    }
}
