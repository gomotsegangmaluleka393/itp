package za.hmf.driver;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Menu;
import android.view.MenuItem;
import android.view.View;
import android.widget.TextView;

import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

import com.google.android.material.button.MaterialButton;
import com.google.android.material.button.MaterialButtonToggleGroup;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

import za.hmf.core.Api;
import za.hmf.core.BaseActivity;
import za.hmf.core.Fmt;
import za.hmf.core.JsonAdapter;
import za.hmf.core.Session;
import za.hmf.core.Steps;

/** Driver home: deliveries to do today, and recently completed ones. */
public class MainActivity extends BaseActivity {

    private JsonAdapter adapter;
    private SwipeRefreshLayout refresh;
    private TextView empty, summary;
    private MaterialButton routeBtn;
    private boolean showDone = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);
        setTitle(R.string.app_name);

        ((TextView) findViewById(R.id.greeting)).setText("Hi " + Session.firstName(this));
        summary = findViewById(R.id.summary);
        empty = findViewById(R.id.empty);
        refresh = findViewById(R.id.refresh);
        routeBtn = findViewById(R.id.routeBtn);

        adapter = new JsonAdapter(R.layout.core_item_delivery, this::bindRow, this::openDelivery);
        RecyclerView list = findViewById(R.id.list);
        list.setLayoutManager(new LinearLayoutManager(this));
        list.setAdapter(adapter);

        refresh.setOnRefreshListener(this::load);

        MaterialButtonToggleGroup tabs = findViewById(R.id.tabs);
        tabs.addOnButtonCheckedListener((group, id, checked) -> {
            if (!checked) return;
            showDone = id == R.id.tabDone;
            load();
        });

        routeBtn.setOnClickListener(v -> openRoute());

        // Android 13+: ask once to show notifications (shown while sharing location)
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        load();
    }

    private void load() {
        refresh.setRefreshing(true);
        Api.get(this, "/api/driver/me", new Api.Callback() {
            @Override public void onSuccess(Object r) {
                JSONObject me = (JSONObject) r;
                summary.setText(me.optInt("active") + " to deliver · " + me.optInt("delivered_today") + " delivered today");
            }
            @Override public void onError(int status, String message) { /* the list call shows errors */ }
        });

        Api.get(this, "/api/driver/deliveries" + (showDone ? "?scope=done" : ""), new Api.Callback() {
            @Override public void onSuccess(Object r) {
                refresh.setRefreshing(false);
                JSONArray rows = (JSONArray) r;
                adapter.setItems(rows);
                empty.setText(showDone ? R.string.no_completed : R.string.no_active);
                empty.setVisibility(rows.length() == 0 ? View.VISIBLE : View.GONE);
                routeBtn.setVisibility(!showDone && rows.length() > 0 ? View.VISIBLE : View.GONE);
            }
            @Override public void onError(int status, String message) {
                refresh.setRefreshing(false);
                handleError(status, message);
            }
        });
    }

    private void bindRow(View row, JSONObject d, int position) {
        ((TextView) row.findViewById(R.id.itemTitle)).setText(Fmt.str(d, "patient_name"));
        Fmt.badge(this, row.findViewById(R.id.itemBadge), d.optString("status"));
        ((TextView) row.findViewById(R.id.itemLine1)).setText(address(d));

        String when = Fmt.day(Fmt.str(d, "scheduled_date"));
        String win = Fmt.clock(Fmt.str(d, "scheduled_window_start"));
        if (!win.isEmpty()) when += "  " + win + "–" + Fmt.clock(Fmt.str(d, "scheduled_window_end"));
        if (showDone) when = Fmt.dateTime(Fmt.str(d, "delivered_at").isEmpty() ? Fmt.str(d, "dispatched_at") : Fmt.str(d, "delivered_at"));
        ((TextView) row.findViewById(R.id.itemLine2)).setText(when);

        TextView warn = row.findViewById(R.id.itemWarning);
        warn.setText("ID check needed");
        warn.setVisibility(d.optBoolean("id_check_required") && !showDone ? View.VISIBLE : View.GONE);

        row.findViewById(R.id.itemSteps).setVisibility(View.GONE); // drivers don't need the progress bar in the list
    }

    static String address(JSONObject d) {
        StringBuilder b = new StringBuilder(Fmt.str(d, "address_line1"));
        for (String k : new String[]{"address_line2", "city", "postal_code"}) {
            String v = Fmt.str(d, k);
            if (!v.isEmpty()) b.append(", ").append(v);
        }
        return b.toString();
    }

    private void openDelivery(JSONObject d) {
        startActivity(new Intent(this, DeliveryActivity.class).putExtra("id", d.optString("delivery_id")));
    }

    /** All open deliveries as one Google Maps route (in time-window order). */
    private void openRoute() {
        List<String> stops = new ArrayList<>();
        for (JSONObject d : adapter.getItems()) stops.add(address(d) + ", " + Fmt.str(d, "country"));
        if (stops.isEmpty()) return;

        String destination = stops.get(stops.size() - 1);
        StringBuilder url = new StringBuilder("https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=")
                .append(Uri.encode(destination));
        if (stops.size() > 1) {
            url.append("&waypoints=").append(Uri.encode(String.join("|", stops.subList(0, stops.size() - 1))));
        }
        startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url.toString())));
    }

    @Override
    public boolean onCreateOptionsMenu(Menu menu) {
        getMenuInflater().inflate(R.menu.main_menu, menu);
        return true;
    }

    @Override
    public boolean onOptionsItemSelected(MenuItem item) {
        if (item.getItemId() == R.id.menuLogout) {
            LocationService.stopAll(this);
            logout();
            return true;
        }
        return super.onOptionsItemSelected(item);
    }
}
