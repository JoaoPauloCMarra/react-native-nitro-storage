package com.nitrostorage

import android.content.Context
import android.os.Build
import java.io.File
import java.io.RandomAccessFile
import java.lang.reflect.InvocationTargetException
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
import org.robolectric.util.ReflectionHelpers

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], manifest = Config.NONE)
class AndroidStorageAdapterDiskTest {
    private lateinit var context: Context

    @Before
    fun setUp() {
        context = RuntimeEnvironment.getApplication()
        resetInstance()
        context.getSharedPreferences("NitroStorage", Context.MODE_PRIVATE).edit().clear().commit()
        val database = File(context.filesDir, "nitro-storage-disk.sqlite")
        database.delete()
        File(database.path + "-wal").delete()
        File(database.path + "-shm").delete()
    }

    @After
    fun tearDown() {
        currentInstance()?.let { instance ->
            runCatching { diskStore(instance).close() }
        }
        resetInstance()
        AndroidStorageAdapter.diskDatabaseOpener = ::openDiskDatabase
    }

    private fun instanceField() =
        AndroidStorageAdapter::class.java.getDeclaredField("instance").apply { isAccessible = true }

    private fun currentInstance(): AndroidStorageAdapter? = instanceField().get(null) as AndroidStorageAdapter?

    private fun resetInstance() = instanceField().set(null, null)

    private fun diskStore(instance: AndroidStorageAdapter): DiskSqliteStore {
        val getter = AndroidStorageAdapter::class.java.getDeclaredMethod("getDiskStore")
        getter.isAccessible = true
        return getter.invoke(instance) as DiskSqliteStore
    }

    private fun failureMessage(block: () -> Unit): String? {
        return try {
            block()
            null
        } catch (error: RuntimeException) {
            error.message
        }
    }

    @Test
    fun diskOperationsBeforeInitReportTheSetupError() {
        val message = failureMessage { AndroidStorageAdapter.setDisk("k", "v") }
        assertTrue(message!!.startsWith("NitroStorage not initialized."))
    }

    @Test
    fun initDoesNotOpenTheDiskDatabase() {
        AndroidStorageAdapter.init(context)
        assertFalse(File(context.filesDir, "nitro-storage-disk.sqlite").exists())
        assertNull(AndroidStorageAdapter.getDisk("missing"))
        assertTrue(File(context.filesDir, "nitro-storage-disk.sqlite").exists())
    }

    @Test
    fun diskApiRoundTripsThroughTheStaticEntryPoints() {
        AndroidStorageAdapter.init(context)
        AndroidStorageAdapter.setDisk("a", "1")
        AndroidStorageAdapter.setDiskBatch(arrayOf("b", "c"), arrayOf("2", "3"))
        assertEquals("1", AndroidStorageAdapter.getDisk("a"))
        assertArrayEquals(arrayOf("2", null), AndroidStorageAdapter.getDiskBatch(arrayOf("b", "missing")))
        assertTrue(AndroidStorageAdapter.hasDisk("c"))
        assertEquals(3, AndroidStorageAdapter.sizeDisk())
        assertEquals(setOf("a", "b", "c"), AndroidStorageAdapter.getAllKeysDisk().toSet())
        assertArrayEquals(arrayOf("a"), AndroidStorageAdapter.getKeysByPrefixDisk("a"))
        AndroidStorageAdapter.deleteDisk("a")
        AndroidStorageAdapter.deleteDiskBatch(arrayOf("b"))
        assertEquals(1, AndroidStorageAdapter.sizeDisk())
        AndroidStorageAdapter.clearDisk()
        assertEquals(0, AndroidStorageAdapter.sizeDisk())
    }

    @Test
    fun fullDatabaseErrorsCarryTheStorageFullTagOnEveryWritePath() {
        AndroidStorageAdapter.init(context)
        AndroidStorageAdapter.setDisk("kept", "value")
        diskStore(currentInstance()!!).database().limitPageCount()
        val oversized = "x".repeat(1 shl 20)
        val tag = "[nitro-error:storage_full] NitroStorage: Disk SQLite set failed: "

        assertTrue(failureMessage { AndroidStorageAdapter.setDisk("oversized", oversized) }!!.startsWith(tag))
        val batch = failureMessage {
            AndroidStorageAdapter.setDiskBatch(arrayOf("small", "oversized"), arrayOf("1", oversized))
        }
        assertTrue(batch, batch!!.startsWith(tag))
        val second = failureMessage {
            AndroidStorageAdapter.setDiskBatch(arrayOf("oversized", "small"), arrayOf(oversized, "1"))
        }
        assertTrue(second, second!!.startsWith(tag))

        assertEquals("value", AndroidStorageAdapter.getDisk("kept"))
        assertFalse(AndroidStorageAdapter.hasDisk("small"))
        assertEquals(1, AndroidStorageAdapter.sizeDisk())
        AndroidStorageAdapter.deleteDiskBatch(arrayOf("kept"))
        AndroidStorageAdapter.deleteDisk("kept")
        AndroidStorageAdapter.clearDisk()
        assertEquals(0, AndroidStorageAdapter.sizeDisk())
    }

    private val corruptionTag = "[nitro-error:storage_corruption] NitroStorage: Disk SQLite "

    private fun diskOperations(): List<Pair<String, () -> Unit>> = listOf(
        "set" to { AndroidStorageAdapter.setDisk("k", "v") },
        "get" to { AndroidStorageAdapter.getDisk("k") },
        "remove" to { AndroidStorageAdapter.deleteDisk("k") },
        "has" to { AndroidStorageAdapter.hasDisk("k") },
        "getAllKeys" to { AndroidStorageAdapter.getAllKeysDisk() },
        "getKeysByPrefix" to { AndroidStorageAdapter.getKeysByPrefixDisk("k") },
        "size" to { AndroidStorageAdapter.sizeDisk() },
        "setBatch" to { AndroidStorageAdapter.setDiskBatch(arrayOf("k"), arrayOf("v")) },
        "getBatch" to { AndroidStorageAdapter.getDiskBatch(arrayOf("k")) },
        "removeBatch" to { AndroidStorageAdapter.deleteDiskBatch(arrayOf("k")) },
    )

    private fun assertRecoveredEmptyStore() {
        assertEquals(0, AndroidStorageAdapter.sizeDisk())
        AndroidStorageAdapter.setDisk("after", "ok")
        assertEquals("ok", AndroidStorageAdapter.getDisk("after"))
        assertTrue(context.getSharedPreferences("NitroStorage", Context.MODE_PRIVATE).all.isEmpty())
    }

    @Test
    fun corruptDatabaseFileIsReportedOnEveryCallAndRecoveredOnlyByClear() {
        val database = File(context.filesDir, "nitro-storage-disk.sqlite")
        val garbage = ByteArray(8192) { 'x'.code.toByte() }
        database.writeBytes(garbage)
        File(database.path + "-wal").writeBytes(garbage)
        File(database.path + "-shm").writeBytes(garbage)
        File(database.path + "-journal").writeBytes(garbage)
        context.getSharedPreferences("NitroStorage", Context.MODE_PRIVATE)
            .edit().putString("legacy", "value").commit()
        AndroidStorageAdapter.init(context)

        for ((name, operation) in diskOperations()) {
            val message = failureMessage(operation)
            assertTrue("$name: $message", message!!.startsWith(corruptionTag))
        }
        assertArrayEquals(garbage, database.readBytes())

        AndroidStorageAdapter.clearDisk()
        assertFalse(File(database.path + "-journal").exists())
        assertRecoveredEmptyStore()
        assertFalse(AndroidStorageAdapter.hasDisk("legacy"))
    }

    @Test
    fun corruptionFoundAfterOpenIsReportedAndRecoveredByClear() {
        AndroidStorageAdapter.init(context)
        AndroidStorageAdapter.setDiskBatch(arrayOf("a", "b", "c"), arrayOf("1", "2", "3"))
        diskStore(currentInstance()!!).close()
        resetInstance()

        AndroidStorageAdapter.init(context)
        diskStore(currentInstance()!!)
        val database = File(context.filesDir, "nitro-storage-disk.sqlite")
        val pageSize = diskStore(currentInstance()!!).database()
            .rawQuery("PRAGMA page_size", null).use { cursor ->
                cursor.moveToFirst()
                cursor.getLong(0)
            }
        assertTrue(database.length() >= 3 * pageSize)
        RandomAccessFile(database, "rw").use { file ->
            file.seek(pageSize)
            file.write(ByteArray((database.length() - pageSize).toInt()) { 'x'.code.toByte() })
        }

        val read = failureMessage { AndroidStorageAdapter.getDisk("a") }
        assertTrue(read, read!!.startsWith(corruptionTag))
        val write = failureMessage { AndroidStorageAdapter.setDisk("a", "x") }
        assertTrue(write, write!!.startsWith(corruptionTag))
        assertTrue(database.exists())

        AndroidStorageAdapter.clearDisk()
        assertRecoveredEmptyStore()
        assertFalse(AndroidStorageAdapter.hasDisk("a"))
    }

    @Test
    fun clearOnAFullDatabaseRecreatesItAndFreesSpace() {
        AndroidStorageAdapter.init(context)
        AndroidStorageAdapter.setDiskBatch(
            Array(200) { "bulk-$it" },
            Array(200) { "b".repeat(4000) },
        )
        val store = diskStore(currentInstance()!!)
        val database = File(context.filesDir, "nitro-storage-disk.sqlite")
        store.database().execSQL(
            "CREATE TRIGGER grow_on_delete BEFORE DELETE ON kv BEGIN " +
                "INSERT OR REPLACE INTO kv(key, value) VALUES('grow', hex(zeroblob(1048576))); END",
        )
        store.close()
        resetInstance()
        AndroidStorageAdapter.init(context)
        val reopened = diskStore(currentInstance()!!)
        val sizeBefore = database.length()
        assertTrue(sizeBefore > 500000)
        reopened.database().limitPageCount()
        try {
            reopened.clear()
            fail("Expected the fixture clear to fail")
        } catch (error: android.database.sqlite.SQLiteFullException) {
            assertEquals("storage_full", error.storageErrorCode())
        }
        assertEquals(200, AndroidStorageAdapter.sizeDisk())

        AndroidStorageAdapter.clearDisk()

        assertFalse(reopened === diskStore(currentInstance()!!))
        assertRecoveredEmptyStore()
        diskStore(currentInstance()!!).close()
        assertTrue("size=${database.length()}", database.length() < sizeBefore / 4)
    }

    @Test
    fun callsRacingWithARecreateNeverLeakAClosedDatabaseError() {
        AndroidStorageAdapter.init(context)
        AndroidStorageAdapter.setDisk("k", "v")
        val instance = currentInstance()!!
        val recreate = AndroidStorageAdapter::class.java.getDeclaredMethod("recreateDiskStore")
        recreate.isAccessible = true
        val unexpected = java.util.concurrent.ConcurrentLinkedQueue<Throwable>()
        val running = java.util.concurrent.atomic.AtomicBoolean(true)
        val workers = List(3) { worker ->
            Thread {
                var iteration = 0
                while (running.get()) {
                    try {
                        AndroidStorageAdapter.setDisk("w$worker", "v${iteration++}")
                        AndroidStorageAdapter.getDisk("w$worker")
                        AndroidStorageAdapter.setDiskBatch(arrayOf("a$worker", "b$worker"), arrayOf("1", "2"))
                        AndroidStorageAdapter.sizeDisk()
                    } catch (error: Throwable) {
                        val message = error.message.orEmpty()
                        val normalDiskError = error is RuntimeException &&
                            error !is IllegalStateException &&
                            (message.startsWith("NitroStorage: Disk SQLite ") ||
                                message.startsWith("[nitro-error:"))
                        if (!normalDiskError) {
                            unexpected.add(error)
                        }
                    }
                }
            }.also { it.start() }
        }
        repeat(150) { recreate.invoke(instance) }
        running.set(false)
        workers.forEach { it.join() }
        assertTrue(unexpected.joinToString { it.toString() }, unexpected.isEmpty())
        AndroidStorageAdapter.setDisk("after", "ok")
        assertEquals("ok", AndroidStorageAdapter.getDisk("after"))
    }

    @Test
    fun clearDoesNotDeleteAHealthyDatabaseWhenOnlyTheWalOpenFailsForLackOfSpace() {
        AndroidStorageAdapter.init(context)
        AndroidStorageAdapter.setDiskBatch(arrayOf("a", "b"), arrayOf("1", "2"))
        diskStore(currentInstance()!!).close()
        resetInstance()

        var walAttempts = 0
        AndroidStorageAdapter.diskDatabaseOpener = { path, flags ->
            if (flags and android.database.sqlite.SQLiteDatabase.ENABLE_WRITE_AHEAD_LOGGING != 0) {
                walAttempts += 1
                throw android.database.sqlite.SQLiteFullException("database or disk is full (code 13 SQLITE_FULL)")
            }
            openDiskDatabase(path, flags)
        }
        AndroidStorageAdapter.init(context)
        assertEquals("1", AndroidStorageAdapter.getDisk("a"))
        assertEquals(2, AndroidStorageAdapter.sizeDisk())
        val store = diskStore(currentInstance()!!)

        AndroidStorageAdapter.clearDisk()

        assertTrue(store === diskStore(currentInstance()!!))
        assertEquals(1, walAttempts)
        assertEquals(0, AndroidStorageAdapter.sizeDisk())
    }

    @Test
    fun openThatFailsInBothModesReportsTheFirstErrorWithItsTag() {
        AndroidStorageAdapter.diskDatabaseOpener = { _, flags ->
            if (flags and android.database.sqlite.SQLiteDatabase.ENABLE_WRITE_AHEAD_LOGGING != 0) {
                throw android.database.sqlite.SQLiteFullException("database or disk is full (code 13 SQLITE_FULL)")
            }
            throw android.database.sqlite.SQLiteCantOpenDatabaseException("unable to open database file (code 14)")
        }
        AndroidStorageAdapter.init(context)
        val message = failureMessage { AndroidStorageAdapter.getDisk("a") }
        assertEquals(
            "[nitro-error:storage_full] NitroStorage: Disk SQLite get failed: " +
                "database or disk is full (code 13 SQLITE_FULL)",
            message,
        )
        AndroidStorageAdapter.diskDatabaseOpener = ::openDiskDatabase
        AndroidStorageAdapter.setDisk("a", "1")
        assertEquals("1", AndroidStorageAdapter.getDisk("a"))
    }

    @Test
    fun clearOnAHealthyStoreKeepsTheDatabaseFile() {
        AndroidStorageAdapter.init(context)
        AndroidStorageAdapter.setDisk("a", "1")
        val store = diskStore(currentInstance()!!)
        AndroidStorageAdapter.clearDisk()
        assertTrue(store === diskStore(currentInstance()!!))
        assertEquals(0, AndroidStorageAdapter.sizeDisk())
    }

    @Test
    fun failedLazyOpenIsRetriedOnTheNextDiskCall() {
        val database = File(context.filesDir, "nitro-storage-disk.sqlite")
        assertTrue(database.mkdirs())
        AndroidStorageAdapter.init(context)
        val message = failureMessage { AndroidStorageAdapter.setDisk("k", "v") }
        assertTrue(message, message!!.startsWith("NitroStorage: Disk SQLite set failed: "))
        assertTrue(database.delete())
        AndroidStorageAdapter.setDisk("k", "v")
        assertEquals("v", AndroidStorageAdapter.getDisk("k"))
    }

    @Test
    fun biometryOnlyIsRejectedBelowAndroid11BeforeAnyKeyIsCreated() {
        AndroidStorageAdapter.init(context)
        val createKey = AndroidStorageAdapter::class.java.getDeclaredMethod(
            "createBiometricMasterKey",
            String::class.java,
            Int::class.javaPrimitiveType,
        )
        createKey.isAccessible = true
        val realSdk = Build.VERSION.SDK_INT
        try {
            for (sdk in intArrayOf(24, 28, 29)) {
                ReflectionHelpers.setStaticField(Build.VERSION::class.java, "SDK_INT", sdk)
                try {
                    createKey.invoke(currentInstance(), "alias", 2)
                    fail("Expected BiometryOnly to be rejected on API $sdk")
                } catch (error: InvocationTargetException) {
                    assertEquals(
                        "[nitro-error:biometric_unavailable] NitroStorage: BiometryOnly requires Android 11 or newer.",
                        error.targetException.message,
                    )
                }
            }
        } finally {
            ReflectionHelpers.setStaticField(Build.VERSION::class.java, "SDK_INT", realSdk)
        }
    }
}
