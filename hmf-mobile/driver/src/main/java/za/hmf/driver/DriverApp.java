package za.hmf.driver;

import android.app.Application;

import za.hmf.core.Hmf;
import za.hmf.core.Notify;

/** Runs once when the app starts. */
public class DriverApp extends Application {
    @Override
    public void onCreate() {
        super.onCreate();
        Hmf.loginActivity = LoginActivity.class;
        Notify.createChannels(this);
    }
}
