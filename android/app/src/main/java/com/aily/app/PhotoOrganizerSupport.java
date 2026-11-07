package com.aily.app;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;

/** Pure helpers so metadata/decoding limits can be unit checked without a device. */
final class PhotoOrganizerSupport {
    private PhotoOrganizerSupport() {}

    static final int MAX_DELETE_BATCH = 500;

    static final class BatchTooLargeException extends IllegalArgumentException {
        BatchTooLargeException() { super("Delete at most 500 photos at once."); }
    }

    /** Normalize the entire batch before touching MediaStore; reject paths and URI aliases. */
    static List<String> normalizeDeleteIds(List<?> rawIds) {
        if (rawIds == null) throw new IllegalArgumentException("Photo ids are required.");
        LinkedHashSet<String> ids = new LinkedHashSet<>();
        for (Object value : rawIds) {
            if (!(value instanceof String)) throw new IllegalArgumentException("Photo ids must be strings.");
            String id = ((String) value).trim();
            if (id.isEmpty()) continue;
            long parsed = parseId(id);
            if (!id.equals(Long.toString(parsed))) throw new IllegalArgumentException("Non-canonical photo id.");
            ids.add(id);
        }
        if (ids.size() > MAX_DELETE_BATCH) throw new BatchTooLargeException();
        return new ArrayList<>(ids);
    }

    /** A denied/cancelled sheet must never be mistaken for approval. Approval still needs row verification. */
    static String deletionConsentError(boolean approved, boolean launchFailed) {
        if (launchFailed) return "DELETE_FAILED";
        return approved ? null : "CANCELLED";
    }

    static long parseId(String id) {
        if (id == null || !id.matches("[0-9]+")) throw new IllegalArgumentException("Invalid photo id");
        try {
            return Long.parseLong(id);
        } catch (NumberFormatException error) {
            throw new IllegalArgumentException("Invalid photo id", error);
        }
    }

    static String createdAt(long takenMillis, long addedSeconds) {
        long millis = takenMillis > 0 ? takenMillis : Math.max(0, addedSeconds) * 1000L;
        SimpleDateFormat formatter = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        formatter.setTimeZone(TimeZone.getTimeZone("UTC"));
        return formatter.format(new Date(millis));
    }

    static int sampleSize(int width, int height, int limit) {
        if (width <= 0 || height <= 0 || limit <= 0) throw new IllegalArgumentException("Invalid image dimensions");
        int sample = 1;
        while (Math.max(width, height) / sample > limit && sample <= (1 << 29)) sample *= 2;
        return sample;
    }
}
