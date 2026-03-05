package com.nitrostorage

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.security.KeyStore
import javax.crypto.AEADBadTagException

private fun Throwable.hasCause(type: Class<*>): Boolean {
    var current: Throwable? = this
    while (current != null) {
        if (type.isInstance(current)) return true
        current = current.cause
    }
    return false
}

class AndroidStorageAdapter private constructor(private val context: Context) {
    private val sharedPreferences: SharedPreferences =
        context.getSharedPreferences("NitroStorage", Context.MODE_PRIVATE)

    private val masterKeyAlias = "${context.packageName}.nitro_storage.master_key"

    // FIX A-16: Wrap masterKey initialization with a helpful error message
    private val masterKey: MasterKey = try {
        MasterKey.Builder(context, masterKeyAlias)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
    } catch (e: Exception) {
        throw RuntimeException("NitroStorage: Cannot create encryption key. Device may not support AES256-GCM.", e)
    }

    private val encryptedPreferences: SharedPreferences = initializeEncryptedPreferences("NitroStorageSecure", masterKey)

    private val biometricMasterKeyAlias = "${context.packageName}.nitro_storage.biometric_key"

    private val biometricPreferences: SharedPreferences by lazy {
        try {
            val bioKey = MasterKey.Builder(context, biometricMasterKeyAlias)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .setUserAuthenticationRequired(true, 30)
                .build()
            initializeEncryptedPreferences("NitroStorageBiometric", bioKey)
        } catch (e: Exception) {
            Log.e("NitroStorage", "Biometric storage unavailable: ${e.message}")
            throw RuntimeException("NitroStorage: Biometric storage is not available on this device. " +
                "Ensure biometric hardware is present and credentials are enrolled.", e)
        }
    }

    @Volatile
    private var secureWritesAsync = false

    @Volatile
    private var secureKeysCache: Array<String>? = null

    // FIX A-16: Validate that core dependencies initialized correctly
    init {
        requireNotNull(encryptedPreferences) { "NitroStorage: Failed to initialize encrypted storage" }
    }

    // FIX A-04: Distinguish locked keystore from corrupted storage
    private fun initializeEncryptedPreferences(name: String, key: MasterKey): SharedPreferences {
        return try {
            EncryptedSharedPreferences.create(
                context, name, key,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            )
        } catch (e: Exception) {
            when {
                e.hasCause(AEADBadTagException::class.java) -> {
                    Log.w("NitroStorage", "Corrupted encryption keys for $name, attempting recovery...")
                    clearCorruptedStorage(name, key)
                    try {
                        EncryptedSharedPreferences.create(
                            context, name, key,
                            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
                        )
                    } catch (retryEx: Exception) {
                        throw RuntimeException("NitroStorage: Unrecoverable storage corruption in $name", retryEx)
                    }
                }
                else -> {
                    // Don't wipe on non-corruption failures (e.g., locked keystore)
                    throw RuntimeException(
                        "NitroStorage: Failed to initialize $name (${e::class.simpleName}). " +
                        "This may be a temporary keystore issue. If it persists, clear app data.", e
                    )
                }
            }
        }
    }

    private fun clearCorruptedStorage(name: String, key: MasterKey) {
        try {
            context.deleteSharedPreferences(name)
            val keyStore = KeyStore.getInstance("AndroidKeyStore")
            keyStore.load(null)
            val alias = when {
                name == "NitroStorageSecure" -> masterKeyAlias
                name == "NitroStorageBiometric" -> biometricMasterKeyAlias
                else -> masterKeyAlias
            }
            keyStore.deleteEntry(alias)
            Log.i("NitroStorage", "Cleared corrupted storage: $name")
        } catch (e: Exception) {
            Log.e("NitroStorage", "Failed to clear corrupted storage $name: ${e.message}", e)
        }
    }

    private fun getSecureSafe(prefs: SharedPreferences, key: String): String? {
        return try {
            prefs.getString(key, null)
        } catch (e: Exception) {
            if (e.hasCause(AEADBadTagException::class.java)) {
                Log.w("NitroStorage", "Corrupt entry for key '$key', removing")
                prefs.edit().remove(key).commit()
                null
            } else {
                throw e
            }
        }
    }

    // FIX A-03: Propagate commit failures
    private fun applySecureEditor(editor: SharedPreferences.Editor) {
        try {
            if (secureWritesAsync) {
                editor.apply()
            } else {
                editor.commit()
            }
        } catch (e: Exception) {
            throw RuntimeException("NitroStorage: Failed to write to secure storage: ${e.message}", e)
        }
    }

    // FIX A-02: Synchronized cache invalidation
    private fun invalidateSecureKeysCache() {
        synchronized(this) {
            secureKeysCache = null
        }
    }

    // FIX A-01: Wrap biometricPreferences access in try-catch
    private fun getSecureKeysCached(): Array<String> {
        val cached = secureKeysCache
        if (cached != null) {
            return cached
        }

        synchronized(this) {
            val existing = secureKeysCache
            if (existing != null) {
                return existing
            }
            val keys = linkedSetOf<String>()
            keys.addAll(encryptedPreferences.all.keys)
            try {
                keys.addAll(biometricPreferences.all.keys)
            } catch (e: Exception) {
                Log.d("NitroStorage", "Biometric storage unavailable: ${e.message}")
            }
            val built = keys.toTypedArray()
            secureKeysCache = built
            return built
        }
    }

    companion object {
        @Volatile
        private var instance: AndroidStorageAdapter? = null

        private fun getInstanceOrThrow(): AndroidStorageAdapter {
            return instance ?: throw IllegalStateException(
                "NitroStorage not initialized. Call AndroidStorageAdapter.init(this) in your MainApplication.onCreate(), " +
                "or add 'react-native-nitro-storage' to your Expo plugins array in app.json."
            )
        }

        @JvmStatic
        fun init(context: Context) {
            if (instance == null) {
                synchronized(this) {
                    if (instance == null) {
                        instance = AndroidStorageAdapter(context.applicationContext)
                    }
                }
            }
        }

        @JvmStatic
        fun getContext(): Context {
            return getInstanceOrThrow().context
        }

        @JvmStatic
        fun setSecureWritesAsync(enabled: Boolean) {
            getInstanceOrThrow().secureWritesAsync = enabled
        }

        // --- Disk ---

        @JvmStatic
        fun setDisk(key: String, value: String) {
            getInstanceOrThrow().sharedPreferences.edit().putString(key, value).apply()
        }

        @JvmStatic
        fun setDiskBatch(keys: Array<String>, values: Array<String>) {
            val editor = getInstanceOrThrow().sharedPreferences.edit()
            val count = minOf(keys.size, values.size)
            for (index in 0 until count) {
                editor.putString(keys[index], values[index])
            }
            editor.apply()
        }

        @JvmStatic
        fun getDisk(key: String): String? {
            return getInstanceOrThrow().sharedPreferences.getString(key, null)
        }

        @JvmStatic
        fun getDiskBatch(keys: Array<String>): Array<String?> {
            val prefs = getInstanceOrThrow().sharedPreferences
            return Array(keys.size) { index ->
                prefs.getString(keys[index], null)
            }
        }

        @JvmStatic
        fun deleteDisk(key: String) {
            getInstanceOrThrow().sharedPreferences.edit().remove(key).apply()
        }

        @JvmStatic
        fun deleteDiskBatch(keys: Array<String>) {
            val editor = getInstanceOrThrow().sharedPreferences.edit()
            for (key in keys) {
                editor.remove(key)
            }
            editor.apply()
        }

        @JvmStatic
        fun hasDisk(key: String): Boolean {
            return getInstanceOrThrow().sharedPreferences.contains(key)
        }

        @JvmStatic
        fun getAllKeysDisk(): Array<String> {
            return getInstanceOrThrow().sharedPreferences.all.keys.toTypedArray()
        }

        @JvmStatic
        fun getKeysByPrefixDisk(prefix: String): Array<String> {
            return getInstanceOrThrow().sharedPreferences.all.keys
                .filter { it.startsWith(prefix) }
                .toTypedArray()
        }

        @JvmStatic
        fun sizeDisk(): Int {
            return getInstanceOrThrow().sharedPreferences.all.size
        }

        @JvmStatic
        fun clearDisk() {
            getInstanceOrThrow().sharedPreferences.edit().clear().apply()
        }

        // --- Secure (sync commit by default, async apply when enabled) ---

        @JvmStatic
        fun setSecure(key: String, value: String) {
            val inst = getInstanceOrThrow()
            val editor = inst.encryptedPreferences.edit().putString(key, value)
            inst.applySecureEditor(editor)
            inst.invalidateSecureKeysCache()
        }

        // FIX A-11: Synchronized batch secure set
        @JvmStatic
        fun setSecureBatch(keys: Array<String>, values: Array<String>) {
            val inst = getInstanceOrThrow()
            synchronized(inst) {
                val editor = inst.encryptedPreferences.edit()
                val count = minOf(keys.size, values.size)
                for (index in 0 until count) {
                    editor.putString(keys[index], values[index])
                }
                inst.applySecureEditor(editor)
                inst.invalidateSecureKeysCache()
            }
        }

        @JvmStatic
        fun getSecure(key: String): String? {
            val inst = getInstanceOrThrow()
            return inst.getSecureSafe(inst.encryptedPreferences, key)
        }

        @JvmStatic
        fun getSecureBatch(keys: Array<String>): Array<String?> {
            val inst = getInstanceOrThrow()
            return Array(keys.size) { index ->
                inst.getSecureSafe(inst.encryptedPreferences, keys[index])
            }
        }

        // FIX A-05: Wrap biometric access in deleteSecure
        @JvmStatic
        fun deleteSecure(key: String) {
            val inst = getInstanceOrThrow()
            inst.applySecureEditor(inst.encryptedPreferences.edit().remove(key))
            try {
                inst.applySecureEditor(inst.biometricPreferences.edit().remove(key))
            } catch (e: Exception) {
                Log.d("NitroStorage", "Biometric storage unavailable: ${e.message}")
            }
            inst.invalidateSecureKeysCache()
        }

        // FIX A-11: Synchronized batch secure delete + FIX A-05: biometric try-catch
        @JvmStatic
        fun deleteSecureBatch(keys: Array<String>) {
            val inst = getInstanceOrThrow()
            synchronized(inst) {
                val editor = inst.encryptedPreferences.edit()
                for (key in keys) {
                    editor.remove(key)
                }
                inst.applySecureEditor(editor)
                try {
                    val biometricEditor = inst.biometricPreferences.edit()
                    for (key in keys) {
                        biometricEditor.remove(key)
                    }
                    inst.applySecureEditor(biometricEditor)
                } catch (e: Exception) {
                    Log.d("NitroStorage", "Biometric storage unavailable: ${e.message}")
                }
                inst.invalidateSecureKeysCache()
            }
        }

        // FIX A-10: Wrap biometric access in hasSecure
        @JvmStatic
        fun hasSecure(key: String): Boolean {
            val inst = getInstanceOrThrow()
            val hasInEncrypted = inst.encryptedPreferences.contains(key)
            val hasInBiometric = try {
                inst.biometricPreferences.contains(key)
            } catch (e: Exception) {
                Log.d("NitroStorage", "Biometric storage unavailable: ${e.message}")
                false
            }
            return hasInEncrypted || hasInBiometric
        }

        @JvmStatic
        fun getAllKeysSecure(): Array<String> {
            val inst = getInstanceOrThrow()
            return inst.getSecureKeysCached()
        }

        @JvmStatic
        fun getKeysByPrefixSecure(prefix: String): Array<String> {
            return getAllKeysSecure().filter { it.startsWith(prefix) }.toTypedArray()
        }

        @JvmStatic
        fun sizeSecure(): Int {
            return getInstanceOrThrow().getSecureKeysCached().size
        }

        // FIX A-06: Wrap biometric access in clearSecure
        @JvmStatic
        fun clearSecure() {
            val inst = getInstanceOrThrow()
            inst.applySecureEditor(inst.encryptedPreferences.edit().clear())
            try {
                inst.applySecureEditor(inst.biometricPreferences.edit().clear())
            } catch (e: Exception) {
                Log.d("NitroStorage", "Biometric storage unavailable: ${e.message}")
            }
            inst.invalidateSecureKeysCache()
        }

        // --- Biometric (separate encrypted store, requires recent biometric auth on Android) ---

        @JvmStatic
        fun setSecureBiometric(key: String, value: String) {
            setSecureBiometricWithLevel(key, value, 2)
        }

        // FIX A-01 (setSecureBiometricWithLevel): Throw on unavailability so caller knows
        @JvmStatic
        fun setSecureBiometricWithLevel(key: String, value: String, @Suppress("UNUSED_PARAMETER") level: Int) {
            val inst = getInstanceOrThrow()
            try {
                val editor = inst.biometricPreferences.edit().putString(key, value)
                inst.applySecureEditor(editor)
                inst.invalidateSecureKeysCache()
            } catch (e: Exception) {
                throw RuntimeException("NitroStorage: Biometric storage unavailable on this device", e)
            }
        }

        // FIX A-03 (getSecureBiometric): Return null on biometric unavailability
        @JvmStatic
        fun getSecureBiometric(key: String): String? {
            val inst = getInstanceOrThrow()
            return try {
                inst.getSecureSafe(inst.biometricPreferences, key)
            } catch (e: Exception) {
                Log.d("NitroStorage", "Biometric storage unavailable: ${e.message}")
                null
            }
        }

        @JvmStatic
        fun deleteSecureBiometric(key: String) {
            val inst = getInstanceOrThrow()
            try {
                inst.applySecureEditor(inst.biometricPreferences.edit().remove(key))
                inst.invalidateSecureKeysCache()
            } catch (e: Exception) {
                Log.d("NitroStorage", "Biometric storage unavailable: ${e.message}")
            }
        }

        // FIX A-10 (hasSecureBiometric): Return false on biometric unavailability
        @JvmStatic
        fun hasSecureBiometric(key: String): Boolean {
            return try {
                getInstanceOrThrow().biometricPreferences.contains(key)
            } catch (e: Exception) {
                Log.d("NitroStorage", "Biometric storage unavailable: ${e.message}")
                false
            }
        }

        // FIX A-06 (clearSecureBiometric): Wrap all biometric access in try-catch
        @JvmStatic
        fun clearSecureBiometric() {
            val inst = getInstanceOrThrow()
            try {
                inst.applySecureEditor(inst.biometricPreferences.edit().clear())
                inst.invalidateSecureKeysCache()
            } catch (e: Exception) {
                Log.d("NitroStorage", "Biometric storage unavailable: ${e.message}")
            }
        }
    }
}
