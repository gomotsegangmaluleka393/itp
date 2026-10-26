package za.hmf.patient;

import za.hmf.core.BaseLoginActivity;

/** Patients log in with the same account they use on the patient web portal. */
public class LoginActivity extends BaseLoginActivity {
    @Override protected String appType() { return "patient"; }
    @Override protected Class<?> homeActivity() { return MainActivity.class; }
    @Override protected String subtitle() { return getString(R.string.login_subtitle); }
}
