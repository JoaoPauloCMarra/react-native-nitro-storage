package com.nitrostorage

import android.database.sqlite.SQLiteDatabaseCorruptException
import android.database.sqlite.SQLiteDatabaseLockedException
import android.database.sqlite.SQLiteDiskIOException
import android.database.sqlite.SQLiteException
import android.database.sqlite.SQLiteFullException
import android.database.sqlite.SQLiteReadOnlyDatabaseException
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.UserNotAuthenticatedException
import java.io.IOException
import java.security.InvalidKeyException
import java.security.KeyStoreException
import javax.crypto.AEADBadTagException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], manifest = Config.NONE)
class StorageErrorClassificationTest {
    @Test
    fun fullDatabaseIsStorageFull() {
        assertEquals("storage_full", SQLiteFullException("database or disk is full").storageErrorCode())
    }

    @Test
    fun corruptDatabaseAndBadTagAreStorageCorruption() {
        assertEquals(
            "storage_corruption",
            SQLiteDatabaseCorruptException("database disk image is malformed").storageErrorCode(),
        )
        assertEquals("storage_corruption", AEADBadTagException("bad tag").storageErrorCode())
    }

    @Test
    fun keystoreAuthenticationFailuresAreAuthenticationRequired() {
        assertEquals("authentication_required", UserNotAuthenticatedException().storageErrorCode())
        assertEquals("authentication_required", KeyStoreException("locked").storageErrorCode())
    }

    @Test
    fun invalidatedKeysAreKeyInvalidated() {
        assertEquals("key_invalidated", KeyPermanentlyInvalidatedException().storageErrorCode())
        assertEquals("key_invalidated", InvalidKeyException("invalid").storageErrorCode())
    }

    @Test
    fun classificationWalksTheWholeCauseChain() {
        val nested = RuntimeException(
            "outer",
            IllegalStateException("middle", SQLiteFullException("database or disk is full")),
        )
        assertEquals("storage_full", nested.storageErrorCode())
        assertTrue(nested.hasCause(SQLiteException::class.java))
        assertTrue(!nested.hasCause(IOException::class.java))
    }

    @Test
    fun fullWinsOverCorruptionAndKeystoreCauses() {
        val mixed = SQLiteFullException("full").apply {
            initCause(SQLiteDatabaseCorruptException("corrupt"))
        }
        assertEquals("storage_full", mixed.storageErrorCode())
        val keystore = RuntimeException("outer", UserNotAuthenticatedException()).apply {
            addSuppressed(SQLiteFullException("suppressed is not a cause"))
        }
        assertEquals("authentication_required", keystore.storageErrorCode())
    }

    @Test
    fun otherSqliteFailuresHaveNoCode() {
        assertNull(SQLiteException("generic").storageErrorCode())
        assertNull(SQLiteDiskIOException("disk I/O error").storageErrorCode())
        assertNull(SQLiteDatabaseLockedException("database is locked").storageErrorCode())
        assertNull(SQLiteReadOnlyDatabaseException("readonly").storageErrorCode())
        assertNull(RuntimeException(null as String?).storageErrorCode())
        assertNull(OutOfMemoryError().storageErrorCode())
    }

    @Test
    fun diskIoErrorsAreOutOfSpaceOnlyWhenTheVolumeHasLessThanOneMebibyteFree() {
        val ioError = SQLiteDiskIOException("disk I/O error (code 4874 SQLITE_IOERR_SHMSIZE)")
        assertTrue(isOutOfSpaceFailure(ioError, 0))
        assertTrue(isOutOfSpaceFailure(ioError, OUT_OF_SPACE_USABLE_BYTES - 1))
        assertTrue(isOutOfSpaceFailure(RuntimeException("outer", ioError), 4096))
        assertTrue(isOutOfSpaceFailure(SQLiteDiskIOException("disk I/O error (code 778)"), 0))
        assertTrue(isOutOfSpaceFailure(SQLiteDiskIOException("disk I/O error (code 10)"), 0))
        assertFalse(isOutOfSpaceFailure(SQLiteDiskIOException("disk I/O error"), 0))
        assertFalse(isOutOfSpaceFailure(SQLiteDiskIOException("disk I/O error (code )"), 0))
        assertFalse(isOutOfSpaceFailure(SQLiteDiskIOException(null as String?), 0))
        assertFalse(isOutOfSpaceFailure(ioError, OUT_OF_SPACE_USABLE_BYTES))
        assertFalse(isOutOfSpaceFailure(ioError, Long.MAX_VALUE))
        assertFalse(isOutOfSpaceFailure(ioError, -1))
        assertFalse(isOutOfSpaceFailure(SQLiteException("generic"), 0))
        assertFalse(isOutOfSpaceFailure(SQLiteDatabaseLockedException("database is locked"), 0))
        assertFalse(isOutOfSpaceFailure(SQLiteReadOnlyDatabaseException("readonly"), 0))
        assertEquals(
            "[nitro-error:storage_full] NitroStorage: Disk SQLite remove failed: disk I/O error",
            ioError.wrapStorageException("NitroStorage: Disk SQLite remove failed: disk I/O error", "storage_full").message,
        )
    }

    @Test
    fun readClassDiskIoErrorsAreNeverOutOfSpace() {
        for (message in listOf(
            "disk I/O error (code 266 SQLITE_IOERR_READ)",
            "disk I/O error (code 266)",
            "disk I/O error (code 522 SQLITE_IOERR_SHORT_READ)",
            "disk I/O error (code 522): , while compiling: SELECT 1",
        )) {
            assertFalse(message, isOutOfSpaceFailure(SQLiteDiskIOException(message), 0))
            assertFalse(message, isOutOfSpaceFailure(RuntimeException("outer", SQLiteDiskIOException(message)), 0))
        }
    }

    @Test
    fun onlyTaggedDiskFullAndCorruptionErrorsAreRecoveredByClear() {
        assertTrue(isRecoverableByRecreate(RuntimeException("[nitro-error:storage_full] NitroStorage: Disk SQLite clear failed: x")))
        assertTrue(isRecoverableByRecreate(RuntimeException("[nitro-error:storage_corruption] NitroStorage: Disk SQLite clear failed: x")))
        assertFalse(isRecoverableByRecreate(RuntimeException("NitroStorage: Disk SQLite clear failed: disk I/O error")))
        assertFalse(isRecoverableByRecreate(RuntimeException("[nitro-error:storage_corruption] NitroStorage: Cannot open Secure storage.")))
        assertFalse(isRecoverableByRecreate(RuntimeException("[nitro-error:keychain_locked] NitroStorage: Disk SQLite x")))
        assertFalse(isRecoverableByRecreate(RuntimeException(null as String?)))
    }

    @Test
    fun onlyTheCompensationTagIsTrustedFromMessages() {
        assertEquals(
            "storage_compensation_failed",
            RuntimeException("[nitro-error:storage_compensation_failed] rollback failed").storageErrorCode(),
        )
        assertNull(RuntimeException("[nitro-error:storage_full] spoofed").storageErrorCode())
    }

    @Test
    fun wrapAddsTagMessageAndKeepsTheCause() {
        val cause = SQLiteFullException("database or disk is full (code 13 SQLITE_FULL)")
        val wrapped = cause.wrapStorageException(
            "NitroStorage: Disk SQLite set failed: ${cause.message}",
        )
        assertEquals(
            "[nitro-error:storage_full] NitroStorage: Disk SQLite set failed: " +
                "database or disk is full (code 13 SQLITE_FULL)",
            wrapped.message,
        )
        assertSame(cause, wrapped.cause)
    }

    @Test
    fun wrapKeepsUnclassifiedFailuresUntagged() {
        val cause = SQLiteDiskIOException("disk I/O error")
        val wrapped = cause.wrapStorageException("NitroStorage: Disk SQLite remove failed: ${cause.message}")
        assertEquals("NitroStorage: Disk SQLite remove failed: disk I/O error", wrapped.message)
        assertSame(cause, wrapped.cause)
    }

    @Test
    fun wrapUsesTheDefaultCodeOnlyWhenNothingElseMatches() {
        assertEquals(
            "[nitro-error:biometric_unavailable] unavailable",
            IllegalStateException("x").wrapStorageException("unavailable", "biometric_unavailable").message,
        )
        assertEquals(
            "[nitro-error:key_invalidated] unavailable",
            InvalidKeyException("x").wrapStorageException("unavailable", "biometric_unavailable").message,
        )
    }

    @Test
    fun wrapReturnsAlreadyTaggedRuntimeExceptionsUnchanged() {
        val tagged = RuntimeException("[nitro-error:storage_corruption] NitroStorage: broken")
        assertSame(tagged, tagged.wrapStorageException("ignored", "storage_full"))
        val checked = IOException("[nitro-error:storage_corruption] NitroStorage: broken")
        val wrapped = checked.wrapStorageException("NitroStorage: wrapped")
        assertEquals("NitroStorage: wrapped", wrapped.message)
        assertSame(checked, wrapped.cause)
    }
}
