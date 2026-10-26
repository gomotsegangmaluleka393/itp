package za.hmf.core;

import android.content.Intent;
import android.widget.Toast;

import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;

/** Shared helpers for every screen in both apps. */
public abstract class BaseActivity extends AppCompatActivity {

    protected void toast(String message) {
        Toast.makeText(this, message, Toast.LENGTH_LONG).show();
    }

    /** Shows a server error. A 401 means the login has expired, so go back to the login screen. */
    protected void handleError(int status, String message) {
        if (status == 401) {
            Session.clear(this);
            goToLogin();
            toast(getString(R.string.core_logged_out));
            return;
        }
        toast(message);
    }

    protected void confirm(String title, String message, Runnable onYes) {
        new AlertDialog.Builder(this)
                .setTitle(title)
                .setMessage(message)
                .setPositiveButton(R.string.core_yes, (d, w) -> onYes.run())
                .setNegativeButton(R.string.core_cancel, null)
                .show();
    }

    protected void logout() {
        confirm(getString(R.string.core_logout), getString(R.string.core_logout_question), () ->
                Api.post(this, "/api/logout", null, new Api.Callback() {
                    @Override public void onSuccess(Object result) { finishLogout(); }
                    @Override public void onError(int status, String message) { finishLogout(); }
                }));
    }

    private void finishLogout() {
        Session.clear(this);
        goToLogin();
    }

    protected void goToLogin() {
        Intent i = new Intent(this, Hmf.loginActivity);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        startActivity(i);
        finish();
    }

    @Override
    public boolean onSupportNavigateUp() {
        finish();
        return true;
    }
}
