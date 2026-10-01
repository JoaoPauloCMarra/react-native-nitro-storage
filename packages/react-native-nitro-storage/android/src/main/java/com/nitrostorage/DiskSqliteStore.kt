package com.nitrostorage

import android.content.Context
import android.content.SharedPreferences
import android.database.DatabaseErrorHandler
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteDatabaseCorruptException
import android.database.sqlite.SQLiteException
import java.io.ByteArrayOutputStream
import java.io.File

internal typealias DiskDatabaseOpener = (path: String, flags: Int) -> SQLiteDatabase

internal fun openDiskDatabase(path: String, flags: Int): SQLiteDatabase {
    return SQLiteDatabase.openDatabase(path, null, flags, DatabaseErrorHandler { })
}

internal fun openDiskDatabaseWithWalFallback(
    path: String,
    opener: DiskDatabaseOpener,
): SQLiteDatabase {
    val flags = SQLiteDatabase.CREATE_IF_NECESSARY or SQLiteDatabase.NO_LOCALIZED_COLLATORS
    return try {
        opener(path, flags or SQLiteDatabase.ENABLE_WRITE_AHEAD_LOGGING)
    } catch (walError: SQLiteDatabaseCorruptException) {
        throw walError
    } catch (walError: SQLiteException) {
        try {
            opener(path, flags)
        } catch (fallbackError: Exception) {
            walError.addSuppressed(fallbackError)
            throw walError
        }
    }
}

internal class DiskSqliteStore(
    context: Context,
    private val legacyPreferences: SharedPreferences,
    opener: DiskDatabaseOpener = ::openDiskDatabase,
) {
    private val db: SQLiteDatabase =
        openDiskDatabaseWithWalFallback(databaseFile(context).path, opener)

    init {
        try {
            db.execSQL(synchronousPragmaFor(queryPragma("PRAGMA journal_mode")))
            db.execSQL(
                "CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)",
            )
            db.execSQL(
                "CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY NOT NULL, v TEXT NOT NULL)",
            )
            migrateLegacyPreferences()
        } catch (e: Exception) {
            db.close()
            throw e
        }
    }

    private fun queryPragma(sql: String): String? {
        return db.rawQuery(sql, null).use { cursor ->
            if (cursor.moveToFirst()) cursor.getString(0) else null
        }
    }

    @Synchronized
    fun close() {
        db.close()
    }

    @Synchronized
    fun set(key: String, value: String) {
        db.execSQL(
            "INSERT OR REPLACE INTO kv(key, value) VALUES(?, ?)",
            arrayOf(key, value),
        )
    }

    @Synchronized
    fun get(key: String): String? {
        db.rawQuery(
            "SELECT length(CAST(value AS BLOB)), " +
                "CASE WHEN length(CAST(value AS BLOB)) <= $VALUE_CHUNK_BYTES THEN value END " +
                "FROM kv WHERE key = ? LIMIT 1",
            arrayOf(key),
        ).use { cursor ->
            if (!cursor.moveToFirst()) {
                return null
            }
            if (!cursor.isNull(1)) {
                return cursor.getString(1)
            }
            return readLargeValue(key, cursor.getLong(0))
        }
    }

    private fun readLargeValue(key: String, byteCount: Long): String {
        val bytes = ByteArrayOutputStream(byteCount.coerceAtMost(Int.MAX_VALUE.toLong()).toInt())
        var offset = 1L
        while (offset <= byteCount) {
            val chunk = db.rawQuery(
                "SELECT substr(CAST(value AS BLOB), ?, $VALUE_CHUNK_BYTES) FROM kv WHERE key = ?",
                arrayOf(offset.toString(), key),
            ).use { cursor ->
                if (cursor.moveToFirst()) cursor.getBlob(0) else null
            }
            if (chunk == null || chunk.isEmpty()) {
                break
            }
            bytes.write(chunk, 0, chunk.size)
            offset += chunk.size
        }
        return String(bytes.toByteArray(), Charsets.UTF_8)
    }

    @Synchronized
    fun remove(key: String) {
        db.execSQL("DELETE FROM kv WHERE key = ?", arrayOf(key))
        removeLegacyKeys(listOf(key))
    }

    @Synchronized
    fun has(key: String): Boolean {
        db.rawQuery("SELECT 1 FROM kv WHERE key = ? LIMIT 1", arrayOf(key)).use { cursor ->
            return cursor.moveToFirst()
        }
    }

    @Synchronized
    fun setBatch(keys: Array<String>, values: Array<String>) {
        val count = minOf(keys.size, values.size)
        inTransaction {
            for (index in 0 until count) {
                db.execSQL(
                    "INSERT OR REPLACE INTO kv(key, value) VALUES(?, ?)",
                    arrayOf(keys[index], values[index]),
                )
            }
        }
    }

    @Synchronized
    fun getBatch(keys: Array<String>): Array<String?> {
        return Array(keys.size) { index -> get(keys[index]) }
    }

    @Synchronized
    fun removeBatch(keys: Array<String>) {
        inTransaction {
            for (key in keys) {
                db.execSQL("DELETE FROM kv WHERE key = ?", arrayOf(key))
            }
        }
        removeLegacyKeys(keys.asIterable())
    }

    @Synchronized
    fun getAllKeys(): Array<String> {
        db.rawQuery("SELECT key FROM kv", null).use { cursor ->
            val keys = ArrayList<String>(cursor.count)
            while (cursor.moveToNext()) {
                keys.add(cursor.getString(0))
            }
            return keys.toTypedArray()
        }
    }

    @Synchronized
    fun getKeysByPrefix(prefix: String): Array<String> {
        val cursor = if (hasUnpairedSurrogate(prefix)) {
            db.rawQuery("SELECT key FROM kv WHERE key LIKE ? ESCAPE '\\'", arrayOf(likePattern(prefix)))
        } else {
            db.rawQuery("SELECT key FROM kv WHERE key >= ?1 AND key < (?1 || x'FF')", arrayOf(prefix))
        }
        cursor.use {
            val keys = ArrayList<String>(cursor.count)
            while (cursor.moveToNext()) {
                val key = cursor.getString(0)
                if (key.startsWith(prefix)) {
                    keys.add(key)
                }
            }
            return keys.toTypedArray()
        }
    }

    @Synchronized
    fun size(): Int {
        db.rawQuery("SELECT COUNT(*) FROM kv", null).use { cursor ->
            return if (cursor.moveToFirst()) cursor.getInt(0) else 0
        }
    }

    @Synchronized
    fun clear() {
        db.execSQL("DELETE FROM kv")
        if (legacyPreferences.all.isNotEmpty()) {
            legacyPreferences.edit().clear().apply()
        }
    }

    private fun migrateLegacyPreferences() {
        db.rawQuery(
            "SELECT v FROM meta WHERE k = ? LIMIT 1",
            arrayOf(PREFS_MIGRATION_KEY),
        ).use { cursor ->
            if (cursor.moveToFirst() && cursor.getString(0) == "1") {
                return
            }
        }

        inTransaction {
            for ((key, value) in legacyPreferences.all) {
                if (value is String) {
                    db.execSQL(
                        "INSERT OR IGNORE INTO kv(key, value) VALUES(?, ?)",
                        arrayOf(key, value),
                    )
                }
            }
            db.execSQL(
                "INSERT OR REPLACE INTO meta(k, v) VALUES(?, ?)",
                arrayOf(PREFS_MIGRATION_KEY, "1"),
            )
        }
    }

    private inline fun inTransaction(block: () -> Unit) {
        db.beginTransaction()
        var failure: Throwable? = null
        try {
            block()
            db.setTransactionSuccessful()
        } catch (error: Throwable) {
            failure = error
            throw error
        } finally {
            try {
                db.endTransaction()
            } catch (error: SQLiteException) {
                val primary = failure ?: throw error
                primary.addSuppressed(error)
            }
        }
    }

    private fun removeLegacyKeys(keys: Iterable<String>) {
        val present = keys.filter { legacyPreferences.contains(it) }
        if (present.isEmpty()) {
            return
        }
        val editor = legacyPreferences.edit()
        present.forEach { editor.remove(it) }
        editor.apply()
    }

    companion object {
        private const val DATABASE_NAME = "nitro-storage-disk.sqlite"
        private const val PREFS_MIGRATION_KEY = "prefs_v1"
        private const val VALUE_CHUNK_BYTES = 512 * 1024

        fun databaseFile(context: Context): File = File(context.filesDir, DATABASE_NAME)

        fun deleteDatabaseFiles(context: Context) {
            SQLiteDatabase.deleteDatabase(databaseFile(context))
        }
    }
}

private fun hasUnpairedSurrogate(value: String): Boolean {
    var index = 0
    while (index < value.length) {
        val character = value[index]
        if (Character.isHighSurrogate(character)) {
            if (index + 1 >= value.length || !Character.isLowSurrogate(value[index + 1])) {
                return true
            }
            index += 2
        } else if (Character.isLowSurrogate(character)) {
            return true
        } else {
            index += 1
        }
    }
    return false
}

private fun likePattern(prefix: String): String {
    return buildString {
        for (character in prefix) {
            if (character == '\u0000') break
            if (character == '%' || character == '_' || character == '\\') append('\\')
            append(character)
        }
        append('%')
    }
}

internal fun synchronousPragmaFor(journalMode: String?): String {
    return if (journalMode.equals("wal", ignoreCase = true)) {
        "PRAGMA synchronous=NORMAL"
    } else {
        "PRAGMA synchronous=FULL"
    }
}
