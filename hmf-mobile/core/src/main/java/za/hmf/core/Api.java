package za.hmf.core;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Talks to the hospital server.
 * Calls run on a background thread and the answer comes back on the main thread.
 */
public final class Api {

    /** What the screen gets back after a call. */
    public interface Callback {
        void onSuccess(Object result);              // JSONObject or JSONArray
        void onError(int status, String message);  // status 0 = no connection
    }

    /** Result of a call made on the current thread. */
    public static final class Result {
        public final int status;
        public final Object body;
        public final byte[] bytes;
        public final String error;

        Result(int status, Object body, byte[] bytes, String error) {
            this.status = status;
            this.body = body;
            this.bytes = bytes;
            this.error = error;
        }

        public boolean ok() {
            return status >= 200 && status < 300;
        }
    }

    private static final ExecutorService POOL = Executors.newFixedThreadPool(3);
    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static final int TIMEOUT_MS = 15000;

    private Api() { }

    // ---------- calls from screens ----------

    public static void get(Context ctx, String path, Callback cb) {
        call(ctx, "GET", path, null, cb);
    }

    public static void post(Context ctx, String path, JSONObject body, Callback cb) {
        call(ctx, "POST", path, body == null ? new JSONObject() : body, cb);
    }

    /** PATCH is sent as POST with an override header (HttpURLConnection has no PATCH). */
    public static void patch(Context ctx, String path, JSONObject body, Callback cb) {
        call(ctx, "PATCH", path, body == null ? new JSONObject() : body, cb);
    }

    public static void call(Context ctx, String method, String path, JSONObject body, Callback cb) {
        Context app = ctx.getApplicationContext();
        POOL.execute(() -> {
            Result r = callSync(app, method, path, body);
            MAIN.post(() -> {
                if (r.ok()) cb.onSuccess(r.body);
                else cb.onError(r.status, r.error);
            });
        });
    }

    /** Downloads an image (e.g. a delivery signature). */
    public static void getBytes(Context ctx, String path, BytesCallback cb) {
        Context app = ctx.getApplicationContext();
        POOL.execute(() -> {
            Result r = callSync(app, "GET", path, null);
            MAIN.post(() -> cb.onResult(r.ok() ? r.bytes : null, r.error));
        });
    }

    public interface BytesCallback {
        void onResult(byte[] bytes, String error);
    }

    // ---------- the actual request (call from a background thread only) ----------

    public static Result callSync(Context ctx, String method, String path, JSONObject body) {
        HttpURLConnection c = null;
        try {
            URL url = new URL(Session.baseUrl(ctx) + path);
            c = (HttpURLConnection) url.openConnection();
            c.setConnectTimeout(TIMEOUT_MS);
            c.setReadTimeout(TIMEOUT_MS);
            c.setRequestProperty("Accept", "application/json");

            boolean override = method.equals("PATCH") || method.equals("PUT") || method.equals("DELETE");
            c.setRequestMethod(override ? "POST" : method);
            if (override) c.setRequestProperty("X-HTTP-Method-Override", method);

            String token = Session.token(ctx);
            if (token != null) c.setRequestProperty("Authorization", "Bearer " + token);

            if (body != null) {
                byte[] out = body.toString().getBytes(StandardCharsets.UTF_8);
                c.setDoOutput(true);
                c.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                c.setFixedLengthStreamingMode(out.length);
                try (OutputStream os = c.getOutputStream()) {
                    os.write(out);
                }
            }

            int status = c.getResponseCode();
            InputStream in = status >= 400 ? c.getErrorStream() : c.getInputStream();
            byte[] bytes = in == null ? new byte[0] : readAll(in);
            String type = c.getContentType() == null ? "" : c.getContentType();

            if (!type.contains("json")) {
                return new Result(status, null, bytes, status >= 400 ? "Server error (" + status + ")" : null);
            }
            String text = new String(bytes, StandardCharsets.UTF_8).trim();
            Object json = text.startsWith("[") ? new JSONArray(text) : new JSONObject(text.isEmpty() ? "{}" : text);
            String error = null;
            if (status >= 400) {
                error = json instanceof JSONObject ? ((JSONObject) json).optString("error", "Something went wrong") : "Something went wrong";
            }
            return new Result(status, json, bytes, error);
        } catch (IOException e) {
            return new Result(0, null, null, "Can't reach the hospital server. Check your internet connection.");
        } catch (JSONException e) {
            return new Result(500, null, null, "The server sent an unexpected reply.");
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private static byte[] readAll(InputStream in) throws IOException {
        try (InputStream is = in; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = is.read(buf)) != -1) out.write(buf, 0, n);
            return out.toByteArray();
        }
    }
}
