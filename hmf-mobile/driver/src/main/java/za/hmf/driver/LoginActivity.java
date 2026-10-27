package za.hmf.driver;

import za.hmf.core.BaseLoginActivity;

/** Drivers log in with the email and password the hospital admin gave them. */
public class LoginActivity extends BaseLoginActivity {
    @Override protected String appType() { return "driver"; }
    @Override protected Class<?> homeActivity() { return MainActivity.class; }
    @Override protected String subtitle() { return getString(R.string.login_subtitle); }
}
