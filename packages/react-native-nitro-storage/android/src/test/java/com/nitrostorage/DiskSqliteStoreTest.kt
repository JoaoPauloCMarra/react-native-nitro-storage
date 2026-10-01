package com.nitrostorage

import android.content.Context
import android.content.SharedPreferences
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteDatabaseCorruptException
import android.database.sqlite.SQLiteFullException
import java.io.File
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], manifest = Config.NONE)
class DiskSqliteStoreTest {
    private lateinit var context: Context
    private lateinit var legacy: SharedPreferences
    private val stores = mutableListOf<DiskSqliteStore>()

    @Before
    fun setUp() {
        context = RuntimeEnvironment.getApplication()
        legacy = context.getSharedPreferences("NitroStorage", Context.MODE_PRIVATE)
        legacy.edit().clear().commit()
        databaseFile().delete()
        File(databaseFile().path + "-wal").delete()
        File(databaseFile().path + "-shm").delete()
    }

    @After
    fun tearDown() {
        stores.forEach { runCatching { it.database().close() } }
        stores.clear()
    }

    private fun databaseFile() = File(context.filesDir, "nitro-storage-disk.sqlite")

    private fun openStore(): DiskSqliteStore = DiskSqliteStore(context, legacy).also { stores.add(it) }

    private fun fill(store: DiskSqliteStore): String {
        store.set("kept", "value")
        store.database().limitPageCount()
        return "x".repeat(1 shl 20)
    }

    private fun pragma(store: DiskSqliteStore, name: String): String {
        val database = store.database()
        database.beginTransaction()
        try {
            database.rawQuery("PRAGMA $name", null).use { cursor ->
                assertTrue(cursor.moveToFirst())
                return cursor.getString(0)
            }
        } finally {
            database.endTransaction()
        }
    }

    private fun journalFormatBytes(): Pair<Int, Int> {
        val header = databaseFile().inputStream().use { input -> ByteArray(20).also { input.read(it) } }
        return header[18].toInt() to header[19].toInt()
    }

    private fun assertFull(block: () -> Unit) {
        try {
            block()
            fail("Expected SQLiteFullException")
        } catch (error: SQLiteFullException) {
            assertEquals("storage_full", error.storageErrorCode())
        }
    }

    @Test
    fun roundTripsSingleAndBatchOperations() {
        val store = openStore()
        store.set("theme", "dark")
        store.set("theme", "light")
        store.setBatch(arrayOf("a", "b"), arrayOf("1", "2"))
        assertEquals("light", store.get("theme"))
        assertTrue(store.has("a"))
        assertFalse(store.has("missing"))
        assertNull(store.get("missing"))
        assertArrayEquals(arrayOf("1", null, "2"), store.getBatch(arrayOf("a", "missing", "b")))
        assertEquals(3, store.size())
        assertEquals(setOf("theme", "a", "b"), store.getAllKeys().toSet())
        store.remove("a")
        store.removeBatch(arrayOf("b", "missing"))
        assertEquals(1, store.size())
        store.clear()
        assertEquals(0, store.size())
        assertEquals(0, store.getAllKeys().size)
    }

    @Test
    fun unevenAndEmptyBatchesNeverFail() {
        val store = openStore()
        store.setBatch(arrayOf("a", "b"), arrayOf("1"))
        store.setBatch(arrayOf(), arrayOf())
        store.removeBatch(arrayOf())
        assertEquals("1", store.get("a"))
        assertFalse(store.has("b"))
        assertEquals(0, store.getBatch(arrayOf()).size)
    }

    @Test
    fun prefixQueriesTreatLikeWildcardsAndCaseLiterally() {
        val store = openStore()
        val nulKey = "nul\u0000token"
        store.setBatch(
            arrayOf("User::a", "user::a", "literal%key", "literalXkey", "literal_key", "literal\\key", "%", "_", nulKey),
            arrayOf("1", "2", "3", "4", "5", "6", "7", "8", "9"),
        )
        assertArrayEquals(arrayOf("User::a"), store.getKeysByPrefix("User::"))
        assertArrayEquals(arrayOf("literal%key"), store.getKeysByPrefix("literal%"))
        assertArrayEquals(arrayOf("literal_key"), store.getKeysByPrefix("literal_"))
        assertArrayEquals(arrayOf("literal\\key"), store.getKeysByPrefix("literal\\"))
        assertArrayEquals(arrayOf("%"), store.getKeysByPrefix("%"))
        assertArrayEquals(arrayOf("_"), store.getKeysByPrefix("_"))
        assertArrayEquals(arrayOf(nulKey), store.getKeysByPrefix("nul\u0000"))
        assertEquals(store.size(), store.getKeysByPrefix("").size)
    }

    @Test
    fun hostileKeysAndValuesRoundTrip() {
        val store = openStore()
        val nulValue = "before\u0000after"
        val astral = "😀 café"
        store.set("", "empty-key")
        store.set("empty-value", "")
        store.set("nul", nulValue)
        store.set(astral, astral)
        assertEquals("empty-key", store.get(""))
        assertEquals("", store.get("empty-value"))
        assertTrue(store.has("empty-value"))
        assertEquals(nulValue, store.get("nul"))
        assertEquals(astral, store.get(astral))
        assertTrue(store.getAllKeys().contains(astral))
    }

    @Test
    fun valuesUpToOneMebibyteRoundTrip() {
        val store = openStore()
        val large = "v".repeat(1 shl 20)
        store.set("large", large)
        assertEquals(large, store.get("large"))
    }

    @Test
    fun valuesLargerThanTheCursorWindowRoundTrip() {
        val store = openStore()
        val large = "v".repeat(5 * (1 shl 20)) + "\u00e9\uD83D\uDE00"
        store.set("large", large)
        store.set("small", "s")
        assertEquals(large, store.get("large"))
        assertArrayEquals(arrayOf("s", large, null), store.getBatch(arrayOf("small", "large", "missing")))

        val boundary = 512 * 1024
        for (length in intArrayOf(boundary - 1, boundary, boundary + 1, 2 * boundary, 2 * boundary + 1)) {
            val value = "b".repeat(length - 3) + "\u0000\u00e9"
            store.set("boundary", value)
            assertEquals(value, store.get("boundary"))
        }
        val multiByte = "\uD83D\uDE00".repeat(boundary)
        store.set("multi-byte", multiByte)
        assertEquals(multiByte, store.get("multi-byte"))
    }

    @Test
    fun fullDatabaseFailsEveryGrowingWriteWithSqliteFullException() {
        val store = openStore()
        val oversized = fill(store)
        assertFull { store.set("oversized", oversized) }
        assertFull { store.setBatch(arrayOf("small", "oversized"), arrayOf("1", oversized)) }
        assertEquals("value", store.get("kept"))
        assertFalse(store.has("oversized"))
        assertFalse(store.has("small"))
        assertEquals(1, store.size())
    }

    @Test
    fun failedBatchLeavesNoOpenTransactionAndStoreStaysUsable() {
        val store = openStore()
        val oversized = fill(store)
        assertFull { store.setBatch(arrayOf("a", "b"), arrayOf("1", oversized)) }
        assertFull { store.setBatch(arrayOf("c", "d"), arrayOf(oversized, "2")) }
        store.removeBatch(arrayOf("kept"))
        assertEquals(0, store.size())
        store.setBatch(arrayOf("after"), arrayOf("ok"))
        store.remove("after")
        store.clear()
        assertEquals(0, store.size())
    }

    @Test
    fun reopenAfterFullKeepsCommittedRowsAndAcceptsWrites() {
        val first = openStore()
        val oversized = fill(first)
        assertFull { first.set("oversized", oversized) }
        first.database().close()
        val reopened = openStore()
        assertEquals("value", reopened.get("kept"))
        assertFalse(reopened.has("oversized"))
        reopened.set("oversized", oversized)
        assertEquals(oversized.length, reopened.get("oversized")?.length)
    }

    @Test
    fun legacyPreferencesAreImportedOnceWithoutOverwriting() {
        legacy.edit()
            .putString("legacy", "from-prefs")
            .putString("both", "from-prefs")
            .putInt("number", 1)
            .commit()
        SQLiteDatabase.openOrCreateDatabase(databaseFile(), null).use { db ->
            db.execSQL("CREATE TABLE kv (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)")
            db.execSQL("INSERT INTO kv(key, value) VALUES('both', 'from-sqlite')")
        }
        val first = openStore()
        assertEquals("from-prefs", first.get("legacy"))
        assertEquals("from-sqlite", first.get("both"))
        assertFalse(first.has("number"))
        first.remove("legacy")
        assertFalse(legacy.contains("legacy"))
        first.database().close()

        legacy.edit().putString("late", "ignored").commit()
        val second = openStore()
        assertFalse(second.has("late"))
        assertFalse(second.has("legacy"))
        second.clear()
        assertTrue(legacy.all.isEmpty())
    }

    @Test
    fun interruptedLegacyImportIsRetriedOnNextOpen() {
        legacy.edit().putString("legacy", "x".repeat(1 shl 20)).commit()
        SQLiteDatabase.openOrCreateDatabase(databaseFile(), null).use { db ->
            db.execSQL("CREATE TABLE meta (k TEXT PRIMARY KEY NOT NULL, v TEXT NOT NULL)")
            db.execSQL("INSERT INTO meta(k, v) VALUES('prefs_v1', '0')")
        }
        val store = openStore()
        assertEquals(1 shl 20, store.get("legacy")?.length)
        store.database().close()
        SQLiteDatabase.openOrCreateDatabase(databaseFile(), null).use { db ->
            db.rawQuery("SELECT v FROM meta WHERE k = 'prefs_v1'", null).use { cursor ->
                assertTrue(cursor.moveToFirst())
                assertEquals("1", cursor.getString(0))
            }
        }
    }

    private fun assertWalConfiguration(store: DiskSqliteStore) {
        assertTrue(store.database().isWriteAheadLoggingEnabled)
        assertEquals("wal", pragma(store, "journal_mode").lowercase())
        assertEquals("1", pragma(store, "synchronous"))
        assertEquals("100", pragma(store, "wal_autocheckpoint"))
        assertEquals("524288", pragma(store, "journal_size_limit"))
    }

    @Test
    fun diskDatabaseIsInWalModeAfterOpenAndReopen() {
        val first = openStore()
        assertWalConfiguration(first)
        first.set("kept", "value")
        assertTrue(File(databaseFile().path + "-wal").exists())
        first.database().close()

        assertEquals(2 to 2, journalFormatBytes())

        val second = openStore()
        assertWalConfiguration(second)
        assertEquals("value", second.get("kept"))
    }

    @Test
    fun databaseLeftOpenByAKilledProcessRecoversItsWalOnTheNextOpen() {
        val first = openStore()
        first.setBatch(arrayOf("a", "b"), arrayOf("1", "x".repeat(200000)))
        first.remove("a")
        val copies = listOf("", "-wal", "-shm").map { suffix ->
            val source = File(databaseFile().path + suffix)
            assertTrue(suffix, source.exists())
            suffix to source.readBytes()
        }
        assertTrue(copies[1].second.isNotEmpty())
        first.database().close()
        for ((suffix, bytes) in copies) {
            File(databaseFile().path + suffix).writeBytes(bytes)
        }

        val recovered = openStore()
        assertWalConfiguration(recovered)
        assertFalse(recovered.has("a"))
        assertEquals(200000, recovered.get("b")?.length)
        recovered.set("after", "ok")
        assertEquals(2, recovered.size())
    }

    @Test
    fun hotRollbackJournalFromAnEarlierReleaseIsRolledBackBeforeTheWalSwitch() {
        val source = File(context.filesDir, "hot-source.sqlite")
        source.delete()
        val sourceJournal = File(source.path + "-journal")
        val writer = SQLiteDatabase.openOrCreateDatabase(source, null)
        writer.rawQuery("PRAGMA journal_mode=DELETE", null).use { it.moveToFirst() }
        writer.execSQL("PRAGMA synchronous=FULL")
        writer.execSQL("PRAGMA cache_size=1")
        writer.execSQL("CREATE TABLE kv (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)")
        writer.execSQL("CREATE TABLE meta (k TEXT PRIMARY KEY NOT NULL, v TEXT NOT NULL)")
        writer.execSQL("INSERT INTO meta(k, v) VALUES('prefs_v1', '1')")
        for (index in 0 until 50) {
            writer.execSQL("INSERT INTO kv(key, value) VALUES(?, ?)", arrayOf("committed-$index", "c".repeat(2000)))
        }
        val committedBytes = source.readBytes()
        writer.beginTransaction()
        for (index in 0 until 50) {
            writer.execSQL("UPDATE kv SET value = ? WHERE key = ?", arrayOf("u".repeat(2000), "committed-$index"))
            writer.execSQL("INSERT INTO kv(key, value) VALUES(?, ?)", arrayOf("uncommitted-$index", "u".repeat(2000)))
        }
        assertTrue(sourceJournal.exists() && sourceJournal.length() > 0)
        assertFalse(committedBytes.contentEquals(source.readBytes()))
        databaseFile().writeBytes(source.readBytes())
        File(databaseFile().path + "-journal").writeBytes(sourceJournal.readBytes())
        writer.endTransaction()
        writer.close()
        source.delete()

        val store = openStore()
        assertWalConfiguration(store)
        assertEquals(50, store.size())
        assertEquals("c".repeat(2000), store.get("committed-7"))
        assertFalse(store.has("uncommitted-7"))
        assertFalse(File(databaseFile().path + "-journal").exists())
        store.set("after", "ok")
        assertEquals(51, store.size())
    }

    @Test
    fun rollbackJournalDatabaseFromAnEarlierReleaseConvertsToWalAndKeepsItsRows() {
        legacy.edit().putString("late", "ignored").commit()
        SQLiteDatabase.openOrCreateDatabase(databaseFile(), null).use { db ->
            db.rawQuery("PRAGMA journal_mode=DELETE", null).use { cursor ->
                assertTrue(cursor.moveToFirst())
                assertEquals("delete", cursor.getString(0).lowercase())
            }
            db.execSQL("CREATE TABLE kv (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)")
            db.execSQL("CREATE TABLE meta (k TEXT PRIMARY KEY NOT NULL, v TEXT NOT NULL)")
            db.execSQL("INSERT INTO kv(key, value) VALUES('theme', 'dark')")
            db.execSQL("INSERT INTO kv(key, value) VALUES('large', ?)", arrayOf("v".repeat(1 shl 20)))
            db.execSQL("INSERT INTO meta(k, v) VALUES('prefs_v1', '1')")
        }

        val converted = openStore()
        assertWalConfiguration(converted)
        assertEquals("dark", converted.get("theme"))
        assertEquals(1 shl 20, converted.get("large")?.length)
        assertFalse(converted.has("late"))
        assertEquals(2, converted.size())
        converted.set("added", "after-conversion")
        converted.database().close()

        val reopened = openStore()
        assertWalConfiguration(reopened)
        assertEquals("dark", reopened.get("theme"))
        assertEquals("after-conversion", reopened.get("added"))
        assertEquals(3, reopened.size())
    }

    private fun openStoreWith(opener: DiskDatabaseOpener): DiskSqliteStore =
        DiskSqliteStore(context, legacy, opener).also { stores.add(it) }

    private fun seedRollbackJournalDatabase() {
        SQLiteDatabase.openOrCreateDatabase(databaseFile(), null).use { db ->
            db.rawQuery("PRAGMA journal_mode=TRUNCATE", null).use { it.moveToFirst() }
            db.execSQL("CREATE TABLE kv (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)")
            db.execSQL("CREATE TABLE meta (k TEXT PRIMARY KEY NOT NULL, v TEXT NOT NULL)")
            db.execSQL("INSERT INTO kv(key, value) VALUES('theme', 'dark')")
            db.execSQL("INSERT INTO meta(k, v) VALUES('prefs_v1', '1')")
        }
    }

    private val baseFlags = SQLiteDatabase.CREATE_IF_NECESSARY or SQLiteDatabase.NO_LOCALIZED_COLLATORS
    private val walFlags = baseFlags or SQLiteDatabase.ENABLE_WRITE_AHEAD_LOGGING

    @Test
    fun walOpenThatFailsForLackOfSpaceFallsBackToAPlainOpenAndStaysReadable() {
        seedRollbackJournalDatabase()
        val requestedFlags = mutableListOf<Int>()
        val store = openStoreWith { path, flags ->
            requestedFlags.add(flags)
            if (flags and SQLiteDatabase.ENABLE_WRITE_AHEAD_LOGGING != 0) {
                throw SQLiteFullException("database or disk is full (code 13 SQLITE_FULL)")
            }
            openDiskDatabase(path, flags)
        }
        assertEquals(listOf(walFlags, baseFlags), requestedFlags)
        assertFalse(store.database().isWriteAheadLoggingEnabled)
        assertFalse(pragma(store, "journal_mode").equals("wal", ignoreCase = true))
        assertEquals("2", pragma(store, "synchronous"))
        assertEquals("dark", store.get("theme"))
        assertEquals(1, store.size())
        assertArrayEquals(arrayOf("theme"), store.getKeysByPrefix("th"))
        store.clear()
        assertTrue(databaseFile().exists())
        store.database().close()

        val nextLaunch = openStore()
        assertWalConfiguration(nextLaunch)
        assertEquals(0, nextLaunch.size())
    }

    @Test
    fun corruptWalOpenIsNotRetried() {
        val requestedFlags = mutableListOf<Int>()
        val corrupt = SQLiteDatabaseCorruptException("file is not a database (code 26 SQLITE_NOTADB)")
        try {
            openStoreWith { _, flags ->
                requestedFlags.add(flags)
                throw corrupt
            }
            fail("Expected SQLiteDatabaseCorruptException")
        } catch (error: SQLiteDatabaseCorruptException) {
            assertTrue(error === corrupt)
        }
        assertEquals(listOf(walFlags), requestedFlags)
    }

    @Test
    fun firstErrorIsReportedWhenTheFallbackOpenAlsoFails() {
        val requestedFlags = mutableListOf<Int>()
        val first = SQLiteFullException("database or disk is full (code 13 SQLITE_FULL)")
        val second = android.database.sqlite.SQLiteDiskIOException("disk I/O error (code 778)")
        try {
            openStoreWith { _, flags ->
                requestedFlags.add(flags)
                throw if (flags and SQLiteDatabase.ENABLE_WRITE_AHEAD_LOGGING != 0) first else second
            }
            fail("Expected SQLiteFullException")
        } catch (error: SQLiteFullException) {
            assertTrue(error === first)
            assertArrayEquals(arrayOf<Throwable>(second), error.suppressed)
            assertEquals("storage_full", error.storageErrorCode())
        }
        assertEquals(listOf(walFlags, baseFlags), requestedFlags)
    }

    @Test
    fun databaseCreatedWithLocalizedCollatorsKeepsItsRowsAndMetadataTable() {
        SQLiteDatabase.openOrCreateDatabase(databaseFile(), null).use { db ->
            db.execSQL("CREATE TABLE kv (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)")
            db.execSQL("INSERT INTO kv(key, value) VALUES('theme', 'dark')")
            db.rawQuery("SELECT locale FROM android_metadata", null).use { cursor ->
                assertTrue(cursor.moveToFirst())
            }
        }
        val store = openStore()
        assertWalConfiguration(store)
        assertEquals("dark", store.get("theme"))
        assertArrayEquals(arrayOf("theme"), store.getKeysByPrefix("t"))
        store.set("caf\u00e9", "1")
        store.set("Cafe", "2")
        assertEquals(setOf("theme", "caf\u00e9", "Cafe"), store.getAllKeys().toSet())
        store.database().rawQuery("SELECT COUNT(*) FROM android_metadata", null).use { cursor ->
            assertTrue(cursor.moveToFirst())
            assertEquals(1, cursor.getInt(0))
        }
    }

    @Test
    fun newDatabaseHasNoLocaleMetadataTable() {
        val store = openStore()
        store.database().rawQuery(
            "SELECT COUNT(*) FROM sqlite_master WHERE name = 'android_metadata'",
            null,
        ).use { cursor ->
            assertTrue(cursor.moveToFirst())
            assertEquals(0, cursor.getInt(0))
        }
    }

    @Test
    fun synchronousModeIsNormalOnlyWithWal() {
        assertEquals("PRAGMA synchronous=NORMAL", synchronousPragmaFor("wal"))
        assertEquals("PRAGMA synchronous=NORMAL", synchronousPragmaFor("WAL"))
        for (mode in listOf("delete", "truncate", "persist", "memory", "off", "", null)) {
            assertEquals("PRAGMA synchronous=FULL", synchronousPragmaFor(mode))
        }
    }

    @Test
    fun journalFilesStaySmallAfterALargeBatch() {
        val store = openStore()
        store.setBatch(
            Array(3000) { "bulk-$it" },
            Array(3000) { "b".repeat(2000) },
        )
        for (index in 0 until 8) {
            store.set("after-$index", "v")
        }
        for (suffix in listOf("-wal", "-journal")) {
            val journal = File(databaseFile().path + suffix)
            assertTrue("$suffix=${journal.length()}", journal.length() <= (1L shl 20))
        }
        assertEquals(3008, store.size())
    }

    @Test
    fun corruptDatabaseFileFailsOpenWithStorageCorruptionAndIsNotDeleted() {
        val garbage = ByteArray(8192) { 'x'.code.toByte() }
        databaseFile().writeBytes(garbage)
        for (attempt in 0 until 3) {
            try {
                openStore()
                fail("Expected SQLiteDatabaseCorruptException")
            } catch (error: SQLiteDatabaseCorruptException) {
                assertEquals("storage_corruption", error.storageErrorCode())
            }
            assertArrayEquals(garbage, databaseFile().readBytes())
        }
    }

    @Test
    fun prefixRangeQueryMatchesTheLikeScanItReplaced() {
        val store = openStore()
        val keys = arrayOf(
            "", "a", "A", "ab", "aB", "Ab", "abc", "ab%", "ab_", "ab\\", "a%", "a_", "%", "%%", "_", "__", "\\",
            "\\%", "user::1", "User::1", "USER::1", "user::", "user:;", "user:", "caf\u00e9", "caf\u00e9::1",
            "cafe", "caf", "nul\u0000token", "nul", "nul\u0000", "\u0000", "\u0000\u0000", "\uD83D\uDE00",
            "\uD83D\uDE00x", "\uD83D\uDE01", "\uFFFF", "\uFFFFz", "\uDBFF\uDFFF", "\uDBFF\uDFFFz", "z", "zz",
            "\u007f", "\u0080", "\u07ff", "\u0800", "\uD800", "\uDC00x", "x\uD83D",
        )
        store.setBatch(keys, Array(keys.size) { "v$it" })
        val prefixes = keys.toMutableSet()
        prefixes.addAll(
            listOf(
                "u", "U", "us", "user", "USER", "ab", "AB", "ca", "caf\u00e9:", "n", "nu", "nul\u0000t", "\uD83D",
                "\uDE00", "\uDBFF", "\uFFFE", "missing", "zzz", "%a", "_a", "a\\", "\u00e9",
            ),
        )
        for (prefix in prefixes) {
            assertArrayEquals(
                "prefix=" + prefix.map { it.code.toString(16) },
                likeScan(store, prefix).sortedArray(),
                store.getKeysByPrefix(prefix).sortedArray(),
            )
        }
        assertEquals(store.getAllKeys().size, store.getKeysByPrefix("").size)
    }

    private fun likeScan(store: DiskSqliteStore, prefix: String): Array<String> {
        val pattern = buildString {
            for (character in prefix) {
                if (character == '\u0000') break
                if (character == '%' || character == '_' || character == '\\') append('\\')
                append(character)
            }
            append('%')
        }
        store.database().rawQuery(
            "SELECT key FROM kv WHERE key LIKE ? ESCAPE '\\'",
            arrayOf(pattern),
        ).use { cursor ->
            val keys = ArrayList<String>()
            while (cursor.moveToNext()) {
                val key = cursor.getString(0)
                if (key.startsWith(prefix)) {
                    keys.add(key)
                }
            }
            return keys.toTypedArray()
        }
    }

    @Test
    fun staleSideFilesNextToAValidDatabaseDoNotLoseRows() {
        val first = openStore()
        first.set("kept", "value")
        first.database().close()
        val garbage = ByteArray(8192) { 'x'.code.toByte() }
        File(databaseFile().path + "-wal").writeBytes(garbage)
        File(databaseFile().path + "-shm").writeBytes(garbage)
        val second = openStore()
        assertWalConfiguration(second)
        assertEquals("value", second.get("kept"))
        second.set("next", "value")
        assertEquals(2, second.size())
    }

    @Test
    fun closedStoreFailsInsteadOfCrashing() {
        val store = openStore()
        store.database().close()
        try {
            store.set("k", "v")
            fail("Expected IllegalStateException")
        } catch (error: IllegalStateException) {
            assertNull(error.storageErrorCode())
        }
    }
}

internal fun DiskSqliteStore.database(): SQLiteDatabase {
    val field = DiskSqliteStore::class.java.getDeclaredField("db")
    field.isAccessible = true
    return field.get(this) as SQLiteDatabase
}

internal fun SQLiteDatabase.limitPageCount() {
    beginTransaction()
    try {
        rawQuery("PRAGMA max_page_count=1", null).use { it.moveToFirst() }
    } finally {
        endTransaction()
    }
}
