package za.hmf.patient;

import android.content.Intent;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.inputmethod.EditorInfo;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.core.content.ContextCompat;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import com.google.android.material.chip.Chip;
import com.google.android.material.chip.ChipGroup;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.List;

import za.hmf.core.Api;
import za.hmf.core.BaseActivity;
import za.hmf.core.JsonAdapter;
import za.hmf.core.Session;

/**
 * Health assistant (same chatbot as the web portal).
 * Answers questions about symptoms, medicines, test words, appointments and deliveries,
 * and can pass the question to a nurse.
 */
public class ChatActivity extends BaseActivity {

    private static final String[] QUICK = {
            "Where is my delivery?",
            "How do I take my medicine?",
            "When is my next appointment?",
            "What does HbA1c mean?",
            "I want to talk to a nurse"
    };

    private JsonAdapter messages;
    private RecyclerView list;
    private ChipGroup chips;
    private EditText input;
    private String lastQuestion = "";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_chat);
        if (getSupportActionBar() != null) getSupportActionBar().setDisplayHomeAsUpEnabled(true);
        setTitle(R.string.assistant);

        list = findViewById(R.id.messages);
        chips = findViewById(R.id.chips);
        input = findViewById(R.id.input);

        messages = new JsonAdapter(R.layout.item_chat, this::bindMessage, null);
        LinearLayoutManager lm = new LinearLayoutManager(this);
        lm.setStackFromEnd(true);
        list.setLayoutManager(lm);
        list.setAdapter(messages);

        findViewById(R.id.sendBtn).setOnClickListener(v -> sendTyped());
        input.setOnEditorActionListener((v, actionId, e) -> {
            if (actionId == EditorInfo.IME_ACTION_SEND) { sendTyped(); return true; }
            return false;
        });

        addMessage("bot", "Hi " + Session.firstName(this) + "! I can help with symptoms, your medicines, test words, "
                + "appointments, deliveries and prescriptions. I can also pass your question to a nurse.");
        showQuickReplies();
    }

    // ---------- messages ----------

    private void bindMessage(View row, JSONObject m, int position) {
        boolean mine = m.optString("role").equals("user");
        LinearLayout wrap = row.findViewById(R.id.row);
        TextView bubble = row.findViewById(R.id.bubble);
        wrap.setGravity(mine ? Gravity.END : Gravity.START);
        bubble.setText(m.optString("text"));

        GradientDrawable bg = new GradientDrawable();
        bg.setCornerRadius(16 * getResources().getDisplayMetrics().density);
        if (mine) {
            bg.setColor(ContextCompat.getColor(this, za.hmf.core.R.color.core_brand));
            bubble.setTextColor(ContextCompat.getColor(this, za.hmf.core.R.color.white));
        } else {
            bg.setColor(ContextCompat.getColor(this, za.hmf.core.R.color.white));
            bg.setStroke(1, ContextCompat.getColor(this, za.hmf.core.R.color.core_line));
            bubble.setTextColor(ContextCompat.getColor(this, za.hmf.core.R.color.core_ink));
        }
        bubble.setBackground(bg);
    }

    private void addMessage(String role, String text) {
        JSONObject m = new JSONObject();
        try { m.put("role", role).put("text", text); } catch (JSONException ignored) { }
        messages.add(m);
        list.scrollToPosition(messages.getItemCount() - 1);
    }

    /** The last few messages, so the assistant knows what we were talking about. */
    private JSONArray history() {
        JSONArray h = new JSONArray();
        List<JSONObject> all = messages.getItems();
        for (int i = Math.max(1, all.size() - 8); i < all.size(); i++) h.put(all.get(i));
        return h;
    }

    // ---------- sending ----------

    private void sendTyped() {
        String text = input.getText().toString().trim();
        if (text.isEmpty()) return;
        input.setText("");
        send(text);
    }

    private void send(String text) {
        JSONObject body = new JSONObject();
        try { body.put("message", text).put("history", history()); } catch (JSONException ignored) { }

        lastQuestion = text;
        addMessage("user", text);
        addMessage("bot", "Typing…");
        chips.removeAllViews();

        Api.post(this, "/api/patient/chat", body, new Api.Callback() {
            @Override public void onSuccess(Object r) {
                JSONObject res = (JSONObject) r;
                replaceTyping(res.optString("reply"));
                if (!res.isNull("escalation_id")) addMessage("bot", "Our staff have been alerted and will contact you.");
                showActions(res.optJSONArray("actions"));
            }
            @Override public void onError(int status, String message) {
                replaceTyping(message);
                if (status == 401) handleError(status, message);
                showQuickReplies();
            }
        });
    }

    private void replaceTyping(String text) {
        List<JSONObject> all = messages.getItems();
        if (!all.isEmpty()) {
            try { all.get(all.size() - 1).put("text", text); } catch (JSONException ignored) { }
            messages.notifyItemChanged(all.size() - 1);
        }
        list.scrollToPosition(messages.getItemCount() - 1);
    }

    // ---------- chips under the chat ----------

    private void showQuickReplies() {
        chips.removeAllViews();
        for (String q : QUICK) addChip(q, v -> send(q));
    }

    /** Buttons the assistant suggested: open a screen, or ask a nurse. */
    private void showActions(JSONArray actions) {
        chips.removeAllViews();
        if (actions != null) {
            for (int i = 0; i < actions.length(); i++) {
                JSONObject a = actions.optJSONObject(i);
                if (a == null) continue;
                if ("escalate".equals(a.optString("action"))) {
                    addChip(a.optString("label"), v -> escalate(a, (Chip) v));
                } else {
                    String href = a.optString("href");
                    addChip(a.optString("label"), v -> openLink(href));
                }
            }
        }
        addChip("More questions", v -> showQuickReplies());
    }

    private void addChip(String text, View.OnClickListener onClick) {
        Chip c = new Chip(this);
        c.setText(text);
        c.setOnClickListener(onClick);
        chips.addView(c);
    }

    private void openLink(String href) {
        if (href.contains("prescriptions")) startActivity(new Intent(this, PrescriptionsActivity.class));
        else if (href.contains("deliveries")) finish(); // deliveries are on the home screen
        else startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(Session.baseUrl(this) + href))); // e.g. booking on the web portal
    }

    private void escalate(JSONObject action, Chip chip) {
        JSONObject body = new JSONObject();
        try {
            body.put("category", action.optString("category", "general"))
                .put("urgency", action.optString("urgency", "routine"))
                .put("message", lastQuestion.isEmpty() ? "Patient asked to speak to staff (from the app)" : lastQuestion);
        } catch (JSONException ignored) { }
        chip.setEnabled(false);
        Api.post(this, "/api/patient/chat/escalate", body, new Api.Callback() {
            @Override public void onSuccess(Object r) {
                chip.setText("Request sent");
                addMessage("bot", ((JSONObject) r).optString("message"));
            }
            @Override public void onError(int status, String message) {
                chip.setEnabled(true);
                handleError(status, message);
            }
        });
    }
}
