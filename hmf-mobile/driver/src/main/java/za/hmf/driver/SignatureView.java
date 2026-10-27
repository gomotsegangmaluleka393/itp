package za.hmf.driver;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.util.AttributeSet;
import android.view.MotionEvent;
import android.view.View;

import java.io.ByteArrayOutputStream;

/** A box the patient signs in with their finger. */
public class SignatureView extends View {

    private final Path path = new Path();
    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private boolean signed = false;

    public SignatureView(Context context, AttributeSet attrs) {
        super(context, attrs);
        paint.setColor(Color.BLACK);
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeJoin(Paint.Join.ROUND);
        paint.setStrokeCap(Paint.Cap.ROUND);
        paint.setStrokeWidth(4 * getResources().getDisplayMetrics().density);
        setBackgroundColor(Color.WHITE);
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        canvas.drawPath(path, paint);
    }

    @Override
    public boolean onTouchEvent(MotionEvent e) {
        float x = e.getX(), y = e.getY();
        switch (e.getAction()) {
            case MotionEvent.ACTION_DOWN:
                // stop the page scrolling while signing
                getParent().requestDisallowInterceptTouchEvent(true);
                path.moveTo(x, y);
                return true;
            case MotionEvent.ACTION_MOVE:
                path.lineTo(x, y);
                signed = true;
                break;
            case MotionEvent.ACTION_UP:
                performClick();
                getParent().requestDisallowInterceptTouchEvent(false);
                break;
            default:
                return false;
        }
        invalidate();
        return true;
    }

    @Override
    public boolean performClick() {
        return super.performClick();
    }

    public boolean isSigned() {
        return signed;
    }

    public void clear() {
        path.reset();
        signed = false;
        invalidate();
    }

    /** The signature as PNG bytes (white background). */
    public byte[] toPng() {
        Bitmap bmp = Bitmap.createBitmap(getWidth(), getHeight(), Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(bmp);
        c.drawColor(Color.WHITE);
        c.drawPath(path, paint);
        // make it smaller before sending
        int w = Math.min(600, bmp.getWidth());
        int h = Math.max(1, bmp.getHeight() * w / Math.max(1, bmp.getWidth()));
        Bitmap small = Bitmap.createScaledBitmap(bmp, w, h, true);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        small.compress(Bitmap.CompressFormat.PNG, 100, out);
        return out.toByteArray();
    }
}
