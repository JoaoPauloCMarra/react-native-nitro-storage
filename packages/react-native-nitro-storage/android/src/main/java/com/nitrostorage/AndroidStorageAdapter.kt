package com.nitrostorage

import android.content.Context
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.UserNotAuthenticatedException
import android.content.SharedPreferences
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.security.InvalidKeyException
import java.security.KeyStore
import java.security.KeyStoreException
import javax.crypto.AEADBadTagException

private fun Throwable.hasCause(type: Class<*>): Boolean {
    var current: Throwable? = this
    while (current != null) {
        if (type.isInstance(current)) return true
        current = current.cause
    }
    return false
}

private fun Throwable.storageErrorCode(): String? {
    return when {
        hasCause(AEADBadTagException::class.java) -> "storage_corruption"
        hasCause(UserNotAuthenticatedException::class.java) ||
            hasCause(KeyStoreException::class.java) -> "authentication_required"
        hasCause(KeyPermanentlyInvalidatedException::class.java) ||
            hasCause(InvalidKeyException::class.java) -> "key_invalidated"
        else -> null
    }
}

private fun Throwable.wrapStorageException(
    defaultMessage: String,
    defaultCode: String? = null,
): RuntimeException {
    val code = storageErrorCode() ?: defaultCode
    val message = if (code != null) {
        "[nitro-error:$code] $defaultMessage"
    } else {
        defaultMessage
    }
    return RuntimeException(message, this)
}

class AndroidStorageAdapter private constructor(private val context: Context) {
    private val sharedPreferences: SharedPreferences =
        context.getSharedPreferences("NitroStorage", Context.MODE_PRIVATE)

    private val masterKeyAlias = "${context.packageName}.nitro_storage.master_key"

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
            throw e.wrapStorageException(
                "NitroStorage: Biometric storage is not available on this device. " +
                    "Ensure biometric hardware is present and credentials are enrolled.",
                defaultCode = "biometric_unavailable",
            )
        }
    }

    @Volatile
    private var secureWritesAsync = false

    @Volatile
    private var secureKeysCache: Array<String>? = null

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
                    val freshAlias = if (name == "NitroStorageBiometric") biometricMasterKeyAlias else masterKeyAlias
                    val freshKey = MasterKey.Builder(context, freshAlias)
                        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                        .apply {
                            if (name == "NitroStorageBiometric") {
                                setUserAuthenticationRequired(true, 30)
                            }
                        }
                        .build()
                    try {
                        EncryptedSharedPreferences.create(
                            context, name, freshKey,
                            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
                        )
                    } catch (retryEx: Exception) {
                        throw retryEx.wrapStorageException(
                            "NitroStorage: Unrecoverable storage corruption in $name",
                            defaultCode = "storage_corruption",
                        )
                    }
                }
                else -> {
                    // Don't wipe on non-corruption failures (e.g., locked keystore)
                    throw e.wrapStorageException(
                        "NitroStorage: Failed to initialize $name (${e::class.simpleName}). " +
                            "This may be a temporary keystore issue. If it persists, clear app data.",
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

    private fun applySecureEditor(editor: SharedPreferences.Editor) {
        try {
            if (secureWritesAsync) {
                editor.apply()
            } else {
                editor.commit()
            }
        } catch (e: Exception) {
            throw e.wrapStorageException(
                "NitroStorage: Failed to write to secure storage: ${e.message}",
            )
        }
    }

    private fun invalidateSecureKeysCache() {
        synchronized(this) {
            secureKeysCache = null
        }
    }

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
            val INTERNAL_PREFIX = "__androidx_security_crypto_encrypted_prefs_"
            val keys = linkedSetOf<String>()
            keys.addAll(encryptedPreferences.all.keys.filter { !it.startsWith(INTERNAL_PREFIX) })
            try {
                keys.addAll(biometricPreferences.all.keys.filter { !it.startsWith(INTERNAL_PREFIX) })
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
            synchronized(inst) {
                val editor = inst.encryptedPreferences.edit().putString(key, value)
                inst.applySecureEditor(editor)
                inst.invalidateSecureKeysCache()
            }
        }

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
            return try {
                inst.getSecureSafe(inst.encryptedPreferences, key)
            } catch (e: Exception) {
                throw e.wrapStorageException(
                    "NitroStorage: Failed to read secure storage: ${e.message}",
                )
            }
        }

        @JvmStatic
        fun getSecureBatch(keys: Array<String>): Array<String?> {
            val inst = getInstanceOrThrow()
            return try {
                Array(keys.size) { index ->
                    inst.getSecureSafe(inst.encryptedPreferences, keys[index])
                }
            } catch (e: Exception) {
                throw e.wrapStorageException(
                    "NitroStorage: Failed to read secure storage batch: ${e.message}",
                )
            }
        }

        @JvmStatic
        fun deleteSecure(key: String) {
            val inst = getInstanceOrThrow()
            synchronized(inst) {
                inst.applySecureEditor(inst.encryptedPreferences.edit().remove(key))
                try {
                    inst.applySecureEditor(inst.biometricPreferences.edit().remove(key))
                } catch (e: Exception) {
                    Log.d("NitroStorage", "Biometric storage unavailable: ${e.message}")
                }
                inst.invalidateSecureKeysCache()
            }
        }

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

        @JvmStatic
        fun setSecureBiometricWithLevel(key: String, value: String, @Suppress("UNUSED_PARAMETER") level: Int) {
            val inst = getInstanceOrThrow()
            try {
                val editor = inst.biometricPreferences.edit().putString(key, value)
                inst.applySecureEditor(editor)
                inst.invalidateSecureKeysCache()
            } catch (e: Exception) {
                throw e.wrapStorageException(
                    "NitroStorage: Biometric storage unavailable on this device",
                    defaultCode = "biometric_unavailable",
                )
            }
        }

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

        @JvmStatic
        fun hasSecureBiometric(key: String): Boolean {
            return try {
                getInstanceOrThrow().biometricPreferences.contains(key)
            } catch (e: Exception) {
                Log.d("NitroStorage", "Biometric storage unavailable: ${e.message}")
                false
            }
        }

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
