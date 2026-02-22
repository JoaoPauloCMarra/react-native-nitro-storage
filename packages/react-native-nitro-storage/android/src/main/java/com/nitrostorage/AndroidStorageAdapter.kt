package com.nitrostorage

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.security.KeyStore
import javax.crypto.AEADBadTagException

class AndroidStorageAdapter private constructor(private val context: Context) {
    private val sharedPreferences: SharedPreferences = 
        context.getSharedPreferences("NitroStorage", Context.MODE_PRIVATE)

    private val masterKeyAlias = "${context.packageName}.nitro_storage.master_key"
    private val masterKey: MasterKey = MasterKey.Builder(context, masterKeyAlias)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()
    
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
            Log.w("NitroStorage", "Biometric storage unavailable, falling back to regular encrypted storage: ${e.message}")
            encryptedPreferences
        }
    }

    @Volatile
    private var secureWritesAsync = false
    
    private fun initializeEncryptedPreferences(name: String, key: MasterKey): SharedPreferences {
        return try {
            EncryptedSharedPreferences.create(
                context,
                name,
                key,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            )
        } catch (e: Exception) {
            if (e is AEADBadTagException || e.cause is AEADBadTagException) {
                Log.w("NitroStorage", "Detected corrupted encryption keys for $name, clearing...")
                clearCorruptedStorage(name, key)
                EncryptedSharedPreferences.create(
                    context,
                    name,
                    key,
                    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                    EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
                )
            } else {
                throw RuntimeException(
                    "NitroStorage: Failed to initialize $name. " +
                    "This may be due to corrupted encryption keys. " +
                    "Try clearing app data or reinstalling the app.", e
                )
            }
        }
    }
    
    private fun clearCorruptedStorage(name: String, key: MasterKey) {
        try {
            context.deleteSharedPreferences(name)
            val keyStore = KeyStore.getInstance("AndroidKeyStore")
            keyStore.load(null)
            val alias = if (key === masterKey) masterKeyAlias else biometricMasterKeyAlias
            keyStore.deleteEntry(alias)
            Log.i("NitroStorage", "Cleared corrupted storage: $name")
        } catch (e: Exception) {
            Log.e("NitroStorage", "Failed to clear corrupted storage: $name", e)
        }
    }

    private fun getSecureSafe(prefs: SharedPreferences, key: String): String? {
        return try {
            prefs.getString(key, null)
        } catch (e: Exception) {
            if (e is AEADBadTagException || e.cause is AEADBadTagException) {
                Log.w("NitroStorage", "Corrupt entry for key '$key', removing")
                prefs.edit().remove(key).commit()
                null
            } else {
                throw e
            }
        }
    }

    private fun applySecureEditor(editor: SharedPreferences.Editor) {
        if (secureWritesAsync) {
            editor.apply()
        } else {
            editor.commit()
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
        }

        @JvmStatic
        fun setSecureBatch(keys: Array<String>, values: Array<String>) {
            val inst = getInstanceOrThrow()
            val editor = inst.encryptedPreferences.edit()
            val count = minOf(keys.size, values.size)
            for (index in 0 until count) {
                editor.putString(keys[index], values[index])
            }
            inst.applySecureEditor(editor)
        }
        
        @JvmStatic
        fun getSecure(key: String): String? {
            return getInstanceOrThrow().getSecureSafe(getInstanceOrThrow().encryptedPreferences, key)
        }

        @JvmStatic
        fun getSecureBatch(keys: Array<String>): Array<String?> {
            val inst = getInstanceOrThrow()
            return Array(keys.size) { index ->
                inst.getSecureSafe(inst.encryptedPreferences, keys[index])
            }
        }
        
        @JvmStatic
        fun deleteSecure(key: String) {
            val inst = getInstanceOrThrow()
            inst.applySecureEditor(inst.encryptedPreferences.edit().remove(key))
            inst.applySecureEditor(inst.biometricPreferences.edit().remove(key))
        }

        @JvmStatic
        fun deleteSecureBatch(keys: Array<String>) {
            val inst = getInstanceOrThrow()
            val secureEditor = inst.encryptedPreferences.edit()
            val biometricEditor = inst.biometricPreferences.edit()
            for (key in keys) {
                secureEditor.remove(key)
                biometricEditor.remove(key)
            }
            inst.applySecureEditor(secureEditor)
            inst.applySecureEditor(biometricEditor)
        }

        @JvmStatic
        fun hasSecure(key: String): Boolean {
            val inst = getInstanceOrThrow()
            return inst.encryptedPreferences.contains(key) || inst.biometricPreferences.contains(key)
        }

        @JvmStatic
        fun getAllKeysSecure(): Array<String> {
            val inst = getInstanceOrThrow()
            val keys = linkedSetOf<String>()
            keys.addAll(inst.encryptedPreferences.all.keys)
            keys.addAll(inst.biometricPreferences.all.keys)
            return keys.toTypedArray()
        }

        @JvmStatic
        fun sizeSecure(): Int {
            return getAllKeysSecure().size
        }

        @JvmStatic
        fun clearSecure() {
            val inst = getInstanceOrThrow()
            inst.applySecureEditor(inst.encryptedPreferences.edit().clear())
            inst.applySecureEditor(inst.biometricPreferences.edit().clear())
        }

        // --- Biometric (separate encrypted store, requires recent biometric auth on Android) ---

        @JvmStatic
        fun setSecureBiometric(key: String, value: String) {
            val inst = getInstanceOrThrow()
            val editor = inst.biometricPreferences.edit().putString(key, value)
            inst.applySecureEditor(editor)
        }

        @JvmStatic
        fun getSecureBiometric(key: String): String? {
            return getInstanceOrThrow().getSecureSafe(getInstanceOrThrow().biometricPreferences, key)
        }

        @JvmStatic
        fun deleteSecureBiometric(key: String) {
            val inst = getInstanceOrThrow()
            inst.applySecureEditor(inst.biometricPreferences.edit().remove(key))
        }

        @JvmStatic
        fun hasSecureBiometric(key: String): Boolean {
            return getInstanceOrThrow().biometricPreferences.contains(key)
        }

        @JvmStatic
        fun clearSecureBiometric() {
            val inst = getInstanceOrThrow()
            inst.applySecureEditor(inst.biometricPreferences.edit().clear())
        }
    }
}
