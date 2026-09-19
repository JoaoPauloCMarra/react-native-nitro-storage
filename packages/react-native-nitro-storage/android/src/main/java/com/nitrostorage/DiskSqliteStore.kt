package com.nitrostorage

import android.content.Context
import android.content.SharedPreferences
import android.database.sqlite.SQLiteDatabase
import java.io.File

internal class DiskSqliteStore(
    context: Context,
    private val legacyPreferences: SharedPreferences,
) {
    private val db: SQLiteDatabase

    init {
        val file = File(context.filesDir, DATABASE_NAME)
        db = SQLiteDatabase.openOrCreateDatabase(file, null)
        // PRAGMA journal_mode returns a row; Android forbids result-bearing SQL on execSQL.
        db.rawQuery("PRAGMA journal_mode=WAL", null).close()
        db.execSQL("PRAGMA synchronous=NORMAL")
        db.execSQL(
            "CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)",
        )
        db.execSQL(
            "CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY NOT NULL, v TEXT NOT NULL)",
        )
        migrateLegacyPreferences()
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
        db.rawQuery("SELECT value FROM kv WHERE key = ? LIMIT 1", arrayOf(key)).use { cursor ->
            return if (cursor.moveToFirst()) cursor.getString(0) else null
        }
    }

    @Synchronized
    fun remove(key: String) {
        db.execSQL("DELETE FROM kv WHERE key = ?", arrayOf(key))
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
        db.beginTransaction()
        try {
            for (index in 0 until count) {
                db.execSQL(
                    "INSERT OR REPLACE INTO kv(key, value) VALUES(?, ?)",
                    arrayOf(keys[index], values[index]),
                )
            }
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    @Synchronized
    fun getBatch(keys: Array<String>): Array<String?> {
        return Array(keys.size) { index -> get(keys[index]) }
    }

    @Synchronized
    fun removeBatch(keys: Array<String>) {
        db.beginTransaction()
        try {
            for (key in keys) {
                db.execSQL("DELETE FROM kv WHERE key = ?", arrayOf(key))
            }
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
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
        val pattern = buildString {
            for (character in prefix) {
                if (character == '%' || character == '_' || character == '\\') {
                    append('\\')
                }
                append(character)
            }
            append('%')
        }
        db.rawQuery(
            "SELECT key FROM kv WHERE key LIKE ? ESCAPE '\\'",
            arrayOf(pattern),
        ).use { cursor ->
            val keys = ArrayList<String>(cursor.count)
            while (cursor.moveToNext()) {
                keys.add(cursor.getString(0))
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

        db.beginTransaction()
        try {
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
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    private companion object {
        const val DATABASE_NAME = "nitro-storage-disk.sqlite"
        const val PREFS_MIGRATION_KEY = "prefs_v1"
    }
}
