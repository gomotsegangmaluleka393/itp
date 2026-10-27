package za.hmf.core;

import android.content.Context;
import android.content.SharedPreferences;

/** Keeps the login token and server address on the phone. */
public final class Session {

    private static final String PREFS = "hmf_session";

    private Session() { }

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public static void save(Context ctx, String token, String name, String email) {
        prefs(ctx).edit().putString("token", token).putString("name", name).putString("email", email).apply();
    }

    public static boolean isLoggedIn(Context ctx) {
        return token(ctx) != null;
    }

    public static String token(Context ctx) {
        return prefs(ctx).getString("token", null);
    }

    public static String name(Context ctx) {
        return prefs(ctx).getString("name", "");
    }

    public static String firstName(Context ctx) {
        String n = name(ctx);
        int space = n.indexOf(' ');
        return space > 0 ? n.substring(0, space) : n;
    }

    /** Clears the login but keeps the server address. */
    public static void clear(Context ctx) {
        prefs(ctx).edit().remove("token").remove("name").remove("email").apply();
    }

    // ---------- server address ----------
    // Default comes from res/values/config.xml. 10.0.2.2 is your computer when using the emulator.

    public static String baseUrl(Context ctx) {
        String saved = prefs(ctx).getString("base_url", null);
        String url = saved != null ? saved : ctx.getString(R.string.core_default_server);
        return url.endsWith("/") ? url.substring(0, url.length() - 1) : url;
    }

    public static void setBaseUrl(Context ctx, String url) {
        prefs(ctx).edit().putString("base_url", url.trim()).apply();
    }
}
