package za.hmf.core;

import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;

import androidx.annotation.NonNull;
import androidx.recyclerview.widget.RecyclerView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/** A simple list adapter for rows that come from the server as JSON. */
public class JsonAdapter extends RecyclerView.Adapter<JsonAdapter.Holder> {

    /** Fills one row's views from one JSON item. */
    public interface Binder {
        void bind(View row, JSONObject item, int position);
    }

    public interface OnClick {
        void onClick(JSONObject item);
    }

    private final int layout;
    private final Binder binder;
    private final OnClick onClick;
    private final List<JSONObject> items = new ArrayList<>();

    public JsonAdapter(int layout, Binder binder, OnClick onClick) {
        this.layout = layout;
        this.binder = binder;
        this.onClick = onClick;
    }

    public void setItems(JSONArray array) {
        items.clear();
        if (array != null) {
            for (int i = 0; i < array.length(); i++) {
                JSONObject o = array.optJSONObject(i);
                if (o != null) items.add(o);
            }
        }
        notifyDataSetChanged();
    }

    public void add(JSONObject item) {
        items.add(item);
        notifyItemInserted(items.size() - 1);
    }

    public List<JSONObject> getItems() {
        return items;
    }

    @NonNull
    @Override
    public Holder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        View v = LayoutInflater.from(parent.getContext()).inflate(layout, parent, false);
        return new Holder(v);
    }

    @Override
    public void onBindViewHolder(@NonNull Holder h, int position) {
        JSONObject item = items.get(position);
        binder.bind(h.itemView, item, position);
        if (onClick != null) h.itemView.setOnClickListener(v -> onClick.onClick(item));
    }

    @Override
    public int getItemCount() {
        return items.size();
    }

    public static class Holder extends RecyclerView.ViewHolder {
        Holder(View v) {
            super(v);
        }
    }
}
