package com.aily.app;

import org.junit.Test;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import static org.junit.Assert.*;

public class PhotoOrganizerSupportTest {
    @Test public void normalizesDeletionIdsWithoutMutatingCaller() {
        List<String> input = Arrays.asList(" 1 ", "2", "", "1", " \n", "2");
        assertEquals(Arrays.asList("1", "2"), PhotoOrganizerSupport.normalizeDeleteIds(input));
        assertEquals(" 1 ", input.get(0));
        assertEquals(Collections.emptyList(), PhotoOrganizerSupport.normalizeDeleteIds(Arrays.asList("", "  ")));
    }

    @Test public void rejectsInvalidDeletionBatchesAndPathAliases() {
        List<List<?>> invalid = Arrays.asList(null, Arrays.asList(1), Arrays.asList("1", null),
            Arrays.asList("content://media/external/images/media/1"), Arrays.asList("/sdcard/DCIM/1.jpg"),
            Arrays.asList("01"), Arrays.asList("-1"), Arrays.asList("9223372036854775808"));
        for (List<?> ids : invalid) {
            try {
                PhotoOrganizerSupport.normalizeDeleteIds(ids);
                fail("Accepted invalid deletion ids: " + ids);
            } catch (IllegalArgumentException expected) { }
        }
    }

    @Test public void boundsDeletionTo500UniqueIds() {
        assertEquals(500, PhotoOrganizerSupport.MAX_DELETE_BATCH);
        List<String> ids = new ArrayList<>();
        for (int index = 1; index <= 500; index++) ids.add(Integer.toString(index));
        List<String> duplicates = new ArrayList<>(ids);
        duplicates.addAll(ids);
        duplicates.add("");
        assertEquals(ids, PhotoOrganizerSupport.normalizeDeleteIds(duplicates));
        ids.add("501");
        try {
            PhotoOrganizerSupport.normalizeDeleteIds(ids);
            fail("Accepted over-limit deletion batch");
        } catch (PhotoOrganizerSupport.BatchTooLargeException expected) { }
    }

    @Test public void deniesCancellationAndSenderFailuresWithoutReportingSuccess() {
        assertEquals("CANCELLED", PhotoOrganizerSupport.deletionConsentError(false, false));
        assertEquals("DELETE_FAILED", PhotoOrganizerSupport.deletionConsentError(false, true));
        assertEquals("DELETE_FAILED", PhotoOrganizerSupport.deletionConsentError(true, true));
        assertNull(PhotoOrganizerSupport.deletionConsentError(true, false));
    }

    @Test public void validatesOpaqueNumericAssetIds() {
        assertEquals(123L, PhotoOrganizerSupport.parseId("123"));
        for (String id : new String[]{null, "", "-1", "1.2", "content://external/1", "999999999999999999999999"}) {
            try {
                PhotoOrganizerSupport.parseId(id);
                fail("Accepted invalid id: " + id);
            } catch (IllegalArgumentException expected) { }
        }
    }

    @Test public void normalizesDatesWithAddedDateFallback() {
        assertEquals("1970-01-01T00:00:01.234Z", PhotoOrganizerSupport.createdAt(1234, 9));
        assertEquals("1970-01-01T00:00:09.000Z", PhotoOrganizerSupport.createdAt(0, 9));
        assertEquals("1970-01-01T00:00:00.000Z", PhotoOrganizerSupport.createdAt(0, 0));
    }

    @Test public void boundsDecodedImageDimensions() {
        assertEquals(1, PhotoOrganizerSupport.sampleSize(1200, 800, 1600));
        assertEquals(4, PhotoOrganizerSupport.sampleSize(6000, 4000, 1600));
        assertEquals(4, PhotoOrganizerSupport.sampleSize(4000, 6000, 1600));
        assertEquals(2, PhotoOrganizerSupport.sampleSize(1601, 100, 1600));
    }
}
