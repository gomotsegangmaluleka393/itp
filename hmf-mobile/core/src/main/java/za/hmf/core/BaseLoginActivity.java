package za.hmf.core;

import android.content.Intent;
import android.os.Bundle;
import android.text.TextUtils;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ProgressBar;
import android.widget.TextView;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * Login screen shared by both apps.
 * Each app says which account type it accepts and which screen opens after login.
 */
public abstract class BaseLoginActivity extends BaseActivity {

    /** "driver" or "patient" */
    protected abstract String appType();

    /** Screen to open after logging in. */
    protected abstract Class<?> homeActivity();

    /** Shown under the title, e.g. "For hospital delivery drivers". */
    protected abstract String subtitle();

    private EditText email, password, server;
    private Button loginBtn;
    private ProgressBar progress;
    private TextView error;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // already logged in
        if (Session.isLoggedIn(this)) {
            openHome();
            return;
        }

        setContentView(R.layout.core_activity_login);
        if (getSupportActionBar() != null) getSupportActionBar().hide();

        ((TextView) findViewById(R.id.loginSubtitle)).setText(subtitle());
        email = findViewById(R.id.loginEmail);
        password = findViewById(R.id.loginPassword);
        server = findViewById(R.id.loginServer);
        loginBtn = findViewById(R.id.loginButton);
        progress = findViewById(R.id.loginProgress);
        error = findViewById(R.id.loginError);

        server.setText(Session.baseUrl(this));
        findViewById(R.id.loginServerToggle).setOnClickListener(v ->
                findViewById(R.id.loginServerBox).setVisibility(View.VISIBLE));

        loginBtn.setOnClickListener(v -> login());
    }

    private void login() {
        String e = email.getText().toString().trim();
        String p = password.getText().toString();
        if (TextUtils.isEmpty(e) || TextUtils.isEmpty(p)) {
            showError(getString(R.string.core_enter_email_password));
            return;
        }
        String url = server.getText().toString().trim();
        if (!url.isEmpty()) Session.setBaseUrl(this, url);

        JSONObject body = new JSONObject();
        try {
            body.put("email", e).put("password", p).put("app", appType());
        } catch (JSONException ignored) { }

        setBusy(true);
        Api.post(this, "/api/mobile/login", body, new Api.Callback() {
            @Override
            public void onSuccess(Object result) {
                JSONObject r = (JSONObject) result;
                JSONObject user = r.optJSONObject("user");
                Session.save(BaseLoginActivity.this, r.optString("token"),
                        user == null ? "" : user.optString("name"), e);
                openHome();
            }

            @Override
            public void onError(int status, String message) {
                setBusy(false);
                showError(message);
            }
        });
    }

    private void setBusy(boolean busy) {
        loginBtn.setEnabled(!busy);
        progress.setVisibility(busy ? View.VISIBLE : View.GONE);
        if (busy) error.setVisibility(View.GONE);
    }

    private void showError(String message) {
        error.setText(message);
        error.setVisibility(View.VISIBLE);
    }

    private void openHome() {
        startActivity(new Intent(this, homeActivity()));
        finish();
    }
}
