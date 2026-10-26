package za.hmf.core;

import android.app.Activity;

/** Settings each app sets once when it starts (see DriverApp / PatientApp). */
public final class Hmf {

    /** The login screen to go back to when the user is logged out. */
    public static Class<? extends Activity> loginActivity;

    private Hmf() { }
}
