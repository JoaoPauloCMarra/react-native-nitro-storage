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
    
    private val masterKey: MasterKey = MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()
    
    private val encryptedPreferences: SharedPreferences = initializeEncryptedPreferences()
    
    private fun initializeEncryptedPreferences(): SharedPreferences {
        return try {
            EncryptedSharedPreferences.create(
                context,
                "NitroStorageSecure",
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            )
        } catch (e: Exception) {
            // Handle corrupted keystore keys by clearing and re-initializing
            if (e is AEADBadTagException || e.cause is AEADBadTagException) {
                Log.w("NitroStorage", "Detected corrupted encryption keys, clearing secure storage...")
                clearCorruptedSecureStorage()
                
                // Retry initialization
                EncryptedSharedPreferences.create(
                    context,
                    "NitroStorageSecure",
                    masterKey,
                    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                    EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
                )
            } else {
                throw RuntimeException(
                    "NitroStorage: Failed to initialize secure storage. " +
                    "This may be due to corrupted encryption keys. " +
                    "Try clearing app data or reinstalling the app.", e
                )
            }
        }
    }
    
    private fun clearCorruptedSecureStorage() {
        try {
            // Delete the encrypted shared preferences file
            context.deleteSharedPreferences("NitroStorageSecure")
            
            // Delete the master key from Android Keystore
            val keyStore = KeyStore.getInstance("AndroidKeyStore")
            keyStore.load(null)
            keyStore.deleteEntry(MasterKey.DEFAULT_MASTER_KEY_ALIAS)
            
            Log.i("NitroStorage", "Successfully cleared corrupted secure storage")
        } catch (e: Exception) {
            Log.e("NitroStorage", "Failed to clear corrupted secure storage", e)
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
        fun setDisk(key: String, value: String) {
            getInstanceOrThrow().sharedPreferences.edit().putString(key, value).apply()
        }
        
        @JvmStatic
        fun getDisk(key: String): String? {
            return getInstanceOrThrow().sharedPreferences.getString(key, null)
        }
        
        @JvmStatic
        fun deleteDisk(key: String) {
            getInstanceOrThrow().sharedPreferences.edit().remove(key).apply()
        }
        
        @JvmStatic
        fun setSecure(key: String, value: String) {
            getInstanceOrThrow().encryptedPreferences.edit().putString(key, value).apply()
        }
        
        @JvmStatic
        fun getSecure(key: String): String? {
            return getInstanceOrThrow().encryptedPreferences.getString(key, null)
        }
        
        @JvmStatic
        fun deleteSecure(key: String) {
            getInstanceOrThrow().encryptedPreferences.edit().remove(key).apply()
        }

        @JvmStatic
        fun clearDisk() {
            getInstanceOrThrow().sharedPreferences.edit().clear().apply()
        }

        @JvmStatic
        fun clearSecure() {
            getInstanceOrThrow().encryptedPreferences.edit().clear().apply()
        }
    }
}
