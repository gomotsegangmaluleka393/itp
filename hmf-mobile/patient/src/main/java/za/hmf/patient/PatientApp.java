package za.hmf.patient;

import android.app.Application;

import za.hmf.core.Hmf;
import za.hmf.core.Notify;

/** Runs once when the app starts. */
public class PatientApp extends Application {
    @Override
    public void onCreate() {
        super.onCreate();
        Hmf.loginActivity = LoginActivity.class;
        Notify.createChannels(this);
    }
}
