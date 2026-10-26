package za.hmf.patient;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONArray;

import java.util.concurrent.TimeUnit;

import za.hmf.core.Api;
import za.hmf.core.Session;

/**
 * Checks for delivery updates in the background (Android runs it about every 15 minutes)
 * and shows a notification when something changes.
 */
public class StatusWorker extends Worker {

    private static final String NAME = "delivery-status";

    public StatusWorker(@NonNull Context ctx, @NonNull WorkerParameters params) {
        super(ctx, params);
    }

    /** Called when the app opens. Safe to call many times. */
    public static void schedule(Context ctx) {
        PeriodicWorkRequest req = new PeriodicWorkRequest.Builder(StatusWorker.class, 15, TimeUnit.MINUTES)
                .setConstraints(new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build();
        WorkManager.getInstance(ctx).enqueueUniquePeriodicWork(NAME, ExistingPeriodicWorkPolicy.KEEP, req);
    }

    public static void cancel(Context ctx) {
        WorkManager.getInstance(ctx).cancelUniqueWork(NAME);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context ctx = getApplicationContext();
        if (!Session.isLoggedIn(ctx)) return Result.success();

        Api.Result r = Api.callSync(ctx, "GET", "/api/patient/deliveries", null);
        if (r.ok() && r.body instanceof JSONArray) {
            DeliveryUpdates.check(ctx, (JSONArray) r.body, true);
            return Result.success();
        }
        // try again later if the server couldn't be reached
        return r.status == 0 ? Result.retry() : Result.success();
    }
}
