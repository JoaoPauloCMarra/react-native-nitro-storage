@file:Suppress("DEPRECATION")

package com.nitrostorage

import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.security.keystore.UserNotAuthenticatedException
import android.content.SharedPreferences
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

    private val encryptedPreferences: SharedPreferences = initializeEncryptedPreferences(
        "NitroStorageSecure",
        masterKey,
        masterKeyAlias,
        ::createDefaultMasterKey,
    )

    private val biometricMasterKeyAlias = "${context.packageName}.nitro_storage.biometric_key"
    private val biometricOrPasscodeMasterKeyAlias =
        "${context.packageName}.nitro_storage.biometric_or_passcode_key"
    private val biometricOnlyMasterKeyAlias =
        "${context.packageName}.nitro_storage.biometric_only_key"

    private val legacyBiometricPreferences: SharedPreferences by lazy {
        createBiometricPreferences(
            "NitroStorageBiometric",
            biometricMasterKeyAlias,
            1,
        )
    }

    private val biometricOrPasscodePreferences: SharedPreferences by lazy {
        createBiometricPreferences(
            "NitroStorageBiometricOrPasscode",
            biometricOrPasscodeMasterKeyAlias,
            1,
        )
    }

    private val biometricOnlyPreferences: SharedPreferences by lazy {
        createBiometricPreferences(
            "NitroStorageBiometricOnly",
            biometricOnlyMasterKeyAlias,
            2,
        )
    }

    @Volatile
    private var secureWritesAsync = false

    @Volatile
    private var secureKeysCache: Array<String>? = null

    private fun createDefaultMasterKey(): MasterKey {
        return MasterKey.Builder(context, masterKeyAlias)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
    }

    private fun createBiometricMasterKey(alias: String, level: Int): MasterKey {
        if (level == 2 && Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            throw RuntimeException(
                "[nitro-error:biometric_unavailable] NitroStorage: BiometryOnly requires Android 11 or newer.",
            )
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val authenticationTypes = if (level == 1) {
                KeyProperties.AUTH_BIOMETRIC_STRONG or KeyProperties.AUTH_DEVICE_CREDENTIAL
            } else {
                KeyProperties.AUTH_BIOMETRIC_STRONG
            }
            val keySpec = KeyGenParameterSpec.Builder(
                alias,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setUserAuthenticationRequired(true)
                .setUserAuthenticationParameters(30, authenticationTypes)
                .setInvalidatedByBiometricEnrollment(level == 2)
                .build()
            return MasterKey.Builder(context, alias)
                .setKeyGenParameterSpec(keySpec)
                .build()
        }

        return MasterKey.Builder(context, alias)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .setUserAuthenticationRequired(true, 30)
            .build()
    }

    private fun createBiometricPreferences(
        name: String,
        alias: String,
        level: Int,
    ): SharedPreferences {
        return try {
            val keyFactory = { createBiometricMasterKey(alias, level) }
            initializeEncryptedPreferences(name, keyFactory(), alias, keyFactory)
        } catch (e: Exception) {
            throw e.wrapStorageException(
                "NitroStorage: Biometric storage is not available on this device. " +
                    "Ensure supported authentication is enrolled.",
                defaultCode = "biometric_unavailable",
            )
        }
    }

    private fun initializeEncryptedPreferences(
        name: String,
        key: MasterKey,
        alias: String,
        keyFactory: () -> MasterKey,
    ): SharedPreferences {
        return try {
            EncryptedSharedPreferences.create(
                context, name, key,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            )
        } catch (e: Exception) {
            when {
                e.hasCause(AEADBadTagException::class.java) -> {
                    clearCorruptedStorage(name, alias)
                    val freshKey = keyFactory()
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
                    throw e.wrapStorageException(
                        "NitroStorage: Failed to initialize $name (${e::class.simpleName}). " +
                            "This may be a temporary keystore issue. If it persists, clear app data.",
                    )
                }
            }
        }
    }

    private fun clearCorruptedStorage(name: String, alias: String) {
        context.deleteSharedPreferences(name)
        val keyStore = KeyStore.getInstance("AndroidKeyStore")
        keyStore.load(null)
        keyStore.deleteEntry(alias)
    }

    private fun preferencesFileExists(name: String): Boolean {
        return context.getSharedPreferences(name, Context.MODE_PRIVATE).all.isNotEmpty()
    }

    private fun existingBiometricPreferences(): List<SharedPreferences> {
        val stores = mutableListOf<SharedPreferences>()
        if (preferencesFileExists("NitroStorageBiometricOnly")) {
            stores.add(biometricOnlyPreferences)
        }
        if (preferencesFileExists("NitroStorageBiometricOrPasscode")) {
            stores.add(biometricOrPasscodePreferences)
        }
        if (preferencesFileExists("NitroStorageBiometric")) {
            stores.add(legacyBiometricPreferences)
        }
        for (preferences in stores) {
            preferences.all
        }
        return stores
    }

    private fun biometricPreferencesForLevel(level: Int): SharedPreferences {
        return when (level) {
            1 -> biometricOrPasscodePreferences
            2 -> biometricOnlyPreferences
            else -> throw IllegalArgumentException(
                "NitroStorage: Invalid biometric level. Expected 0, 1, or 2.",
            )
        }
    }

    private fun removeBiometricKey(
        key: String,
        preferencesList: List<SharedPreferences> = existingBiometricPreferences(),
    ) {
        for (preferences in preferencesList) {
            applySecureEditor(preferences.edit().remove(key))
        }
    }

    private fun clearBiometricStores(
        preferencesList: List<SharedPreferences> = existingBiometricPreferences(),
    ) {
        for (preferences in preferencesList) {
            applySecureEditor(preferences.edit().clear())
        }
    }

    private fun getSecureSafe(prefs: SharedPreferences, key: String): String? {
        return try {
            prefs.getString(key, null)
        } catch (e: Exception) {
            if (e.hasCause(AEADBadTagException::class.java)) {
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
            } else if (!editor.commit()) {
                throw IllegalStateException("SharedPreferences commit returned false")
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
            for (preferences in existingBiometricPreferences()) {
                keys.addAll(preferences.all.keys.filter { !it.startsWith(INTERNAL_PREFIX) })
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
                val biometricPreferences = inst.existingBiometricPreferences()
                inst.applySecureEditor(inst.encryptedPreferences.edit().remove(key))
                inst.removeBiometricKey(key, biometricPreferences)
                inst.invalidateSecureKeysCache()
            }
        }

        @JvmStatic
        fun deleteSecureBatch(keys: Array<String>) {
            val inst = getInstanceOrThrow()
            synchronized(inst) {
                val biometricPreferences = inst.existingBiometricPreferences()
                val editor = inst.encryptedPreferences.edit()
                for (key in keys) {
                    editor.remove(key)
                }
                inst.applySecureEditor(editor)
                for (preferences in biometricPreferences) {
                    val biometricEditor = preferences.edit()
                    for (key in keys) {
                        biometricEditor.remove(key)
                    }
                    inst.applySecureEditor(biometricEditor)
                }
                inst.invalidateSecureKeysCache()
            }
        }

        @JvmStatic
        fun hasSecure(key: String): Boolean {
            val inst = getInstanceOrThrow()
            if (inst.encryptedPreferences.contains(key)) {
                return true
            }
            return inst.existingBiometricPreferences().any { it.contains(key) }
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
            synchronized(inst) {
                val biometricPreferences = inst.existingBiometricPreferences()
                inst.applySecureEditor(inst.encryptedPreferences.edit().clear())
                inst.clearBiometricStores(biometricPreferences)
                inst.invalidateSecureKeysCache()
            }
        }

        // --- Biometric (separate encrypted store, requires recent biometric auth on Android) ---

        @JvmStatic
        fun setSecureBiometric(key: String, value: String) {
            setSecureBiometricWithLevel(key, value, 2)
        }

        @JvmStatic
        fun setSecureBiometricWithLevel(key: String, value: String, level: Int) {
            val inst = getInstanceOrThrow()
            try {
                synchronized(inst) {
                    val biometricPreferences = inst.existingBiometricPreferences()
                    if (level == 0) {
                        inst.removeBiometricKey(key, biometricPreferences)
                        inst.applySecureEditor(
                            inst.encryptedPreferences.edit().putString(key, value),
                        )
                    } else {
                        val targetPreferences = inst.biometricPreferencesForLevel(level)
                        inst.applySecureEditor(
                            targetPreferences.edit().putString(key, value),
                        )
                        inst.applySecureEditor(
                            inst.encryptedPreferences.edit().remove(key),
                        )
                        for (preferences in biometricPreferences) {
                            if (preferences !== targetPreferences) {
                                inst.applySecureEditor(preferences.edit().remove(key))
                            }
                        }
                    }
                    inst.invalidateSecureKeysCache()
                }
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
                for (preferences in inst.existingBiometricPreferences()) {
                    val value = inst.getSecureSafe(preferences, key)
                    if (value != null) {
                        return value
                    }
                }
                null
            } catch (e: Exception) {
                throw e.wrapStorageException(
                    "NitroStorage: Failed to read biometric storage: ${e.message}",
                )
            }
        }

        @JvmStatic
        fun deleteSecureBiometric(key: String) {
            val inst = getInstanceOrThrow()
            try {
                synchronized(inst) {
                    inst.removeBiometricKey(key)
                    inst.invalidateSecureKeysCache()
                }
            } catch (e: Exception) {
                throw e.wrapStorageException(
                    "NitroStorage: Failed to delete biometric storage: ${e.message}",
                )
            }
        }

        @JvmStatic
        fun hasSecureBiometric(key: String): Boolean {
            val inst = getInstanceOrThrow()
            return try {
                inst.existingBiometricPreferences().any { it.contains(key) }
            } catch (e: Exception) {
                throw e.wrapStorageException(
                    "NitroStorage: Failed to inspect biometric storage: ${e.message}",
                )
            }
        }

        @JvmStatic
        fun clearSecureBiometric() {
            val inst = getInstanceOrThrow()
            try {
                synchronized(inst) {
                    inst.clearBiometricStores()
                    inst.invalidateSecureKeysCache()
                }
            } catch (e: Exception) {
                throw e.wrapStorageException(
                    "NitroStorage: Failed to clear biometric storage: ${e.message}",
                )
            }
        }
    }
}
