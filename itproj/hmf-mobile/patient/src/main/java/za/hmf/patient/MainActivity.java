package za.hmf.patient;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Menu;
import android.view.MenuItem;
import android.view.View;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

import org.json.JSONArray;
import org.json.JSONObject;

import za.hmf.core.Api;
import za.hmf.core.BaseActivity;
import za.hmf.core.Fmt;
import za.hmf.core.JsonAdapter;
import za.hmf.core.Session;
import za.hmf.core.Steps;

/** Patient home: deliveries with live status. */
public class MainActivity extends BaseActivity {

    private static final long REFRESH_MS = 30_000;

    private JsonAdapter adapter;
    private SwipeRefreshLayout refresh;
    private TextView empty;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable autoRefresh = this::load;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);
        setTitle(R.string.app_name);

        ((TextView) findViewById(R.id.greeting)).setText("Hello, " + Session.firstName(this));
        refresh = findViewById(R.id.refresh);
        empty = findViewById(R.id.empty);

        adapter = new JsonAdapter(R.layout.core_item_delivery, this::bindRow,
                d -> startActivity(new Intent(this, DeliveryActivity.class).putExtra("id", d.optString("delivery_id"))));
        RecyclerView list = findViewById(R.id.list);
        list.setLayoutManager(new LinearLayoutManager(this));
        list.setAdapter(adapter);
        refresh.setOnRefreshListener(this::load);

        findViewById(R.id.fab).setOnClickListener(v -> startActivity(new Intent(this, PrescriptionsActivity.class)));
        findViewById(R.id.rxBtn).setOnClickListener(v -> startActivity(new Intent(this, PrescriptionsActivity.class)));
        findViewById(R.id.chatBtn).setOnClickListener(v -> startActivity(new Intent(this, ChatActivity.class)));

        // background checks for delivery notifications
        StatusWorker.schedule(this);
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        load();
    }

    @Override
    protected void onPause() {
        super.onPause();
        handler.removeCallbacks(autoRefresh);
    }

    private void load() {
        handler.removeCallbacks(autoRefresh);
        refresh.setRefreshing(true);
        Api.get(this, "/api/patient/deliveries", new Api.Callback() {
            @Override public void onSuccess(Object r) {
                refresh.setRefreshing(false);
                JSONArray rows = (JSONArray) r;
                DeliveryUpdates.check(MainActivity.this, rows, false); // already on screen, no notification
                adapter.setItems(rows);
                empty.setVisibility(rows.length() == 0 ? View.VISIBLE : View.GONE);

                // keep refreshing while a delivery is on its way
                for (int i = 0; i < rows.length(); i++) {
                    String s = rows.optJSONObject(i).optString("status");
                    if (s.equals("assigned") || s.equals("out_for_delivery")) {
                        handler.postDelayed(autoRefresh, REFRESH_MS);
                        break;
                    }
                }
            }
            @Override public void onError(int status, String message) {
                refresh.setRefreshing(false);
                handleError(status, message);
            }
        });
    }

    private void bindRow(View row, JSONObject d, int position) {
        String status = d.optString("status");
        String date = Fmt.day(Fmt.str(d, "scheduled_date"));
        ((TextView) row.findViewById(R.id.itemTitle)).setText(date.isEmpty() ? "Delivery" : date);
        Fmt.badge(this, row.findViewById(R.id.itemBadge), status);
        ((TextView) row.findViewById(R.id.itemLine1)).setText(Fmt.str(d, "medicines"));

        String line2;
        if (!Fmt.str(d, "confirmation_code").isEmpty()) line2 = "Your code: " + d.optString("confirmation_code");
        else if (status.equals("delivered")) line2 = "Delivered " + Fmt.dateTime(Fmt.str(d, "delivered_at"));
        else line2 = Fmt.str(d, "failure_reason");
        ((TextView) row.findViewById(R.id.itemLine2)).setText(line2);

        row.findViewById(R.id.itemWarning).setVisibility(View.GONE);
        LinearLayout bar = row.findViewById(R.id.stepsBar);
        Steps.bind(bar, d);
    }

    @Override
    public boolean onCreateOptionsMenu(Menu menu) {
        getMenuInflater().inflate(R.menu.main_menu, menu);
        return true;
    }

    @Override
    public boolean onOptionsItemSelected(MenuItem item) {
        int id = item.getItemId();
        if (id == R.id.menuChat) { startActivity(new Intent(this, ChatActivity.class)); return true; }
        if (id == R.id.menuPrescriptions) { startActivity(new Intent(this, PrescriptionsActivity.class)); return true; }
        if (id == R.id.menuLogout) { StatusWorker.cancel(this); logout(); return true; }
        return super.onOptionsItemSelected(item);
    }
}
