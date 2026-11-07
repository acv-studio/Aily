package com.aily.app;

import android.Manifest;
import android.app.Activity;
import android.app.PendingIntent;
import android.content.Intent;
import androidx.activity.result.ActivityResult;
import androidx.activity.result.IntentSenderRequest;
import androidx.activity.result.contract.ActivityResultContracts;
import android.content.ContentUris;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.media.ExifInterface;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/** Local-only metadata/images; deletion requires an explicit batch call and native system consent.
 * No uploads, filesystem paths, startup permission requests, or direct resolver.delete calls. */
@CapacitorPlugin(name = "PhotoOrganizer", permissions = {
    @Permission(alias = "legacyImages", strings = { Manifest.permission.READ_EXTERNAL_STORAGE }),
    @Permission(alias = "images", strings = { Manifest.permission.READ_MEDIA_IMAGES }),
    @Permission(alias = "selectedImages", strings = { Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED })
})
public class PhotoOrganizerPlugin extends Plugin {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final AtomicBoolean permissionRequestPending = new AtomicBoolean(false);
    private static final int MAX_DIMENSION = 1600;
    private static final int MAX_DELETE_BATCH = PhotoOrganizerSupport.MAX_DELETE_BATCH;
    private final AtomicBoolean deletionPending = new AtomicBoolean(false);

    @PluginMethod
    public void deletePhotos(PluginCall call) {
        JSArray rawIds = call.getArray("ids");
        if (rawIds == null) {
            call.reject("Photo ids must be an array of strings.", "INVALID_IDS");
            return;
        }
        final List<String> ids;
        try {
            ids = PhotoOrganizerSupport.normalizeDeleteIds(rawIds.toList());
        } catch (PhotoOrganizerSupport.BatchTooLargeException error) {
            call.reject("Delete at most 500 photos at once.", "BATCH_TOO_LARGE", error);
            return;
        } catch (Exception error) {
            call.reject("Valid MediaStore photo ids are required.", "INVALID_IDS", error);
            return;
        }
        if (ids.isEmpty()) {
            JSObject result = new JSObject();
            result.put("deletedIds", new JSArray());
            call.resolve(result);
            return;
        }
        // Android 29 only provides per-asset recoverable write access, not safe batch consent.
        // Older versions require broad write permission; neither fallback is enabled.
        if (Build.VERSION.SDK_INT < 30) {
            call.reject("System-confirmed batch photo deletion requires Android 11 or later.", "UNSUPPORTED");
            return;
        }
        if (!fullAccess() && !selectedAccess()) {
            call.reject("Photo access is not granted. Call listPhotos explicitly to request access.", "PERMISSION_DENIED");
            return;
        }
        if (!deletionPending.compareAndSet(false, true)) {
            call.reject("A photo deletion confirmation is already open.", "DELETE_IN_PROGRESS");
            return;
        }
        worker.execute(() -> {
            try {
                List<Uri> uris = new ArrayList<>();
                for (String id : ids) {
                    Uri uri = imageUri(id);
                    if (!imageExists(uri)) {
                        deletionPending.set(false);
                        call.reject("One or more photos are missing or are no longer accessible.", "PHOTO_NOT_FOUND");
                        return;
                    }
                    uris.add(uri);
                }
                // Every requested target was validated as an accessible image before any change.
                PendingIntent consent = MediaStore.createDeleteRequest(getContext().getContentResolver(), uris);
                // ComponentActivity intercepts this AndroidX action and launches the IntentSender.
                // Use Capacitor's annotated ActivityResult lifecycle/saved-call bridge, not deprecated request codes.
                Intent intent = new Intent(ActivityResultContracts.StartIntentSenderForResult.ACTION_INTENT_SENDER_REQUEST);
                intent.putExtra(ActivityResultContracts.StartIntentSenderForResult.EXTRA_INTENT_SENDER_REQUEST,
                    new IntentSenderRequest.Builder(consent.getIntentSender()).build());
                call.getData().put("ids", new JSArray(ids));
                getActivity().runOnUiThread(() -> {
                    try {
                        startActivityForResult(call, intent, "deletePhotosResult");
                    } catch (Exception error) {
                        deletionPending.set(false);
                        call.reject("Unable to open system deletion confirmation.", "DELETE_FAILED", error);
                    }
                });
            } catch (SecurityException error) {
                deletionPending.set(false);
                call.reject("Photo access was revoked. No deletion was requested.", "PERMISSION_DENIED", error);
            } catch (Exception error) {
                deletionPending.set(false);
                call.reject("Unable to prepare photo deletion.", "DELETE_FAILED", error);
            }
        });
    }

    private Uri imageUri(String id) {
        return ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, PhotoOrganizerSupport.parseId(id));
    }

    private boolean imageExists(Uri uri) {
        try (Cursor cursor = getContext().getContentResolver().query(uri,
            new String[]{MediaStore.Images.Media._ID, MediaStore.Images.Media.MIME_TYPE}, null, null, null)) {
            if (cursor == null) throw new IllegalStateException("MediaStore did not return an image cursor.");
            if (!cursor.moveToFirst()) return false;
            String mime = cursor.getString(1);
            if (mime == null || !mime.startsWith("image/")) throw new IllegalArgumentException("Target is not an image.");
            return true;
        }
    }

    @ActivityCallback
    private void deletePhotosResult(PluginCall call, ActivityResult activityResult) {
        if (call == null) {
            deletionPending.set(false);
            return; // Process recreation without a saved JS call must never invent a success.
        }
        Intent data = activityResult.getData();
        boolean launchFailed = data != null && data.hasExtra(
            ActivityResultContracts.StartIntentSenderForResult.EXTRA_SEND_INTENT_EXCEPTION);
        String consentError = PhotoOrganizerSupport.deletionConsentError(
            activityResult.getResultCode() == Activity.RESULT_OK, launchFailed);
        if (consentError != null) {
            deletionPending.set(false);
            call.reject(launchFailed ? "Unable to open system deletion confirmation." : "Photo deletion was cancelled.",
                consentError);
            return;
        }
        worker.execute(() -> {
            try {
                if (!fullAccess() && !selectedAccess()) throw new SecurityException("Photo access was revoked.");
                JSArray ids = call.getArray("ids");
                if (ids == null || ids.length() == 0 || ids.length() > MAX_DELETE_BATCH) {
                    throw new IllegalStateException("Deletion batch could not be restored.");
                }
                for (int index = 0; index < ids.length(); index++) {
                    if (imageExists(imageUri(ids.getString(index)))) {
                        call.reject("MediaStore did not confirm deletion of the entire batch.", "DELETE_FAILED");
                        return;
                    }
                }
                JSObject result = new JSObject();
                result.put("deletedIds", ids);
                call.resolve(result); // Consent alone is insufficient: all image rows must have disappeared.
            } catch (SecurityException error) {
                call.reject("Photo access was revoked before deletion could be verified.", "PERMISSION_DENIED", error);
            } catch (Exception error) {
                call.reject("Unable to verify photo deletion.", "DELETE_FAILED", error);
            } finally {
                deletionPending.set(false);
            }
        });
    }

    private boolean fullAccess() {
        return getPermissionState(Build.VERSION.SDK_INT >= 33 ? "images" : "legacyImages") == PermissionState.GRANTED;
    }

    private boolean selectedAccess() {
        return Build.VERSION.SDK_INT >= 34 && getPermissionState("selectedImages") == PermissionState.GRANTED;
    }

    @PluginMethod
    public void listPhotos(PluginCall call) {
        if (fullAccess() || selectedAccess()) {
            enumeratePhotos(call);
            return;
        }
        if (!permissionRequestPending.compareAndSet(false, true)) {
            call.reject("A photo permission request is already open.", "PERMISSION_REQUEST_IN_PROGRESS");
            return;
        }
        // Runtime request only follows this explicit call; never request broad storage/write access.
        getActivity().runOnUiThread(() -> {
            try {
                String[] aliases = Build.VERSION.SDK_INT >= 34 ? new String[]{"images", "selectedImages"}
                    : new String[]{Build.VERSION.SDK_INT >= 33 ? "images" : "legacyImages"};
                requestPermissionForAliases(aliases, call, "photoPermissionResult");
            } catch (Exception error) {
                permissionRequestPending.set(false);
                call.reject("Unable to request photo permission.", "PERMISSION_REQUEST_FAILED", error);
            }
        });
    }

    @PermissionCallback
    private void photoPermissionResult(PluginCall call) {
        permissionRequestPending.set(false);
        if (fullAccess() || selectedAccess()) {
            enumeratePhotos(call);
        } else {
            call.reject("Photo access was denied or cancelled. Allow photo access in Settings to continue.", "PERMISSION_DENIED");
        }
    }

    private void enumeratePhotos(PluginCall call) {
        worker.execute(() -> {
            try {
                boolean limited = !fullAccess() && selectedAccess();
                JSArray photos = new JSArray();
                String[] projection = { MediaStore.Images.Media._ID, MediaStore.Images.Media.DISPLAY_NAME,
                    MediaStore.Images.Media.DATE_TAKEN, MediaStore.Images.Media.DATE_ADDED };
                try (Cursor cursor = getContext().getContentResolver().query(
                    MediaStore.Images.Media.EXTERNAL_CONTENT_URI, projection, null, null,
                    MediaStore.Images.Media.DATE_ADDED + " DESC, " + MediaStore.Images.Media._ID + " DESC")) {
                    if (cursor == null) throw new IllegalStateException("MediaStore did not return a photo cursor.");
                    while (cursor.moveToNext()) {
                        long id = cursor.getLong(0);
                        String name = cursor.getString(1);
                        long taken = cursor.isNull(2) ? 0 : cursor.getLong(2);
                        long added = cursor.isNull(3) ? 0 : cursor.getLong(3);
                        JSObject photo = new JSObject();
                        photo.put("id", Long.toString(id));
                        photo.put("name", name == null || name.isEmpty() ? "Photo" : name);
                        photo.put("createdAt", PhotoOrganizerSupport.createdAt(taken, added));
                        photos.put(photo);
                    }
                }
                JSObject result = new JSObject();
                result.put("photos", photos);
                result.put("limited", limited);
                call.resolve(result);
            } catch (SecurityException error) {
                call.reject("Photo access was revoked. Request access again.", "PERMISSION_DENIED", error);
            } catch (Exception error) {
                call.reject("Unable to list accessible photos.", "PHOTO_LIST_FAILED", error);
            }
        });
    }

    @PluginMethod
    public void getPhoto(PluginCall call) {
        final long id;
        try {
            id = PhotoOrganizerSupport.parseId(call.getString("id"));
        } catch (IllegalArgumentException error) {
            call.reject("A valid photo id is required.", "INVALID_ID", error);
            return;
        }
        if (!fullAccess() && !selectedAccess()) {
            call.reject("Photo access is not granted. Call listPhotos explicitly to request access.", "PERMISSION_DENIED");
            return;
        }
        worker.execute(() -> {
            Bitmap bitmap = null;
            try {
                Uri uri = ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, id);
                // Confirm the id still points to an accessible image before reading its bytes.
                try (Cursor cursor = getContext().getContentResolver().query(uri,
                    new String[]{MediaStore.Images.Media._ID}, null, null, null)) {
                    if (cursor == null || !cursor.moveToFirst()) {
                        call.reject("This photo is missing or is no longer accessible.", "PHOTO_NOT_FOUND");
                        return;
                    }
                }
                BitmapFactory.Options options = new BitmapFactory.Options();
                options.inJustDecodeBounds = true;
                try (InputStream stream = getContext().getContentResolver().openInputStream(uri)) {
                    if (stream == null) throw new IllegalStateException("Photo stream is unavailable.");
                    BitmapFactory.decodeStream(stream, null, options);
                }
                if (options.outWidth <= 0 || options.outHeight <= 0) throw new IllegalStateException("Unsupported image format.");
                options.inSampleSize = PhotoOrganizerSupport.sampleSize(options.outWidth, options.outHeight, MAX_DIMENSION);
                options.inJustDecodeBounds = false;
                try (InputStream stream = getContext().getContentResolver().openInputStream(uri)) {
                    if (stream == null) throw new IllegalStateException("Photo stream is unavailable.");
                    bitmap = BitmapFactory.decodeStream(stream, null, options);
                }
                if (bitmap == null) throw new IllegalStateException("Unable to decode this photo.");
                // JPEG pixels may be stored sideways/mirrored; preserve their displayed orientation.
                int orientation = ExifInterface.ORIENTATION_NORMAL;
                try (InputStream stream = getContext().getContentResolver().openInputStream(uri)) {
                    if (stream != null) orientation = new ExifInterface(stream).getAttributeInt(
                        ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL);
                } catch (java.io.IOException ignored) { /* Non-EXIF image formats keep their decoded orientation. */ }
                Matrix transform = new Matrix();
                switch (orientation) {
                    case ExifInterface.ORIENTATION_FLIP_HORIZONTAL: transform.setScale(-1, 1); break;
                    case ExifInterface.ORIENTATION_ROTATE_180: transform.setRotate(180); break;
                    case ExifInterface.ORIENTATION_FLIP_VERTICAL: transform.setScale(1, -1); break;
                    case ExifInterface.ORIENTATION_TRANSPOSE: transform.setRotate(90); transform.postScale(-1, 1); break;
                    case ExifInterface.ORIENTATION_ROTATE_90: transform.setRotate(90); break;
                    case ExifInterface.ORIENTATION_TRANSVERSE: transform.setRotate(-90); transform.postScale(-1, 1); break;
                    case ExifInterface.ORIENTATION_ROTATE_270: transform.setRotate(-90); break;
                    default: break;
                }
                if (!transform.isIdentity()) {
                    Bitmap oriented = Bitmap.createBitmap(bitmap, 0, 0, bitmap.getWidth(), bitmap.getHeight(), transform, true);
                    if (oriented != bitmap) bitmap.recycle();
                    bitmap = oriented;
                }
                int longest = Math.max(bitmap.getWidth(), bitmap.getHeight());
                if (longest > MAX_DIMENSION) {
                    float scale = (float) MAX_DIMENSION / longest;
                    Bitmap resized = Bitmap.createScaledBitmap(bitmap, Math.max(1, Math.round(bitmap.getWidth() * scale)),
                        Math.max(1, Math.round(bitmap.getHeight() * scale)), true);
                    if (resized != bitmap) bitmap.recycle();
                    bitmap = resized;
                }
                try (ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
                    if (!bitmap.compress(Bitmap.CompressFormat.JPEG, 80, bytes)) throw new IllegalStateException("Unable to encode photo.");
                    JSObject result = new JSObject();
                    result.put("url", "data:image/jpeg;base64," + Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP));
                    call.resolve(result);
                }
            } catch (SecurityException error) {
                call.reject("This photo is no longer accessible. Request access again.", "PERMISSION_DENIED", error);
            } catch (java.io.FileNotFoundException error) {
                call.reject("This photo is missing or unavailable on this device.", "PHOTO_NOT_FOUND", error);
            } catch (Exception error) {
                call.reject("Unable to load this photo.", "PHOTO_LOAD_FAILED", error);
            } finally {
                if (bitmap != null && !bitmap.isRecycled()) bitmap.recycle();
            }
        });
    }

    @Override
    protected void handleOnDestroy() {
        worker.shutdown();
        super.handleOnDestroy();
    }
}
