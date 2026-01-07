package com.nitrostorage

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

class AndroidStorageAdapter private constructor(private val context: Context) {
    private val sharedPreferences: SharedPreferences = 
        context.getSharedPreferences("NitroStorage", Context.MODE_PRIVATE)
    
    private val masterKey: MasterKey = MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()
    
    private val encryptedPreferences: SharedPreferences = try {
        EncryptedSharedPreferences.create(
            context,
            "NitroStorageSecure",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    } catch (e: Exception) {
        throw RuntimeException(
            "NitroStorage: Failed to initialize secure storage. " +
            "This may be due to corrupted encryption keys. " +
            "Try clearing app data or reinstalling the app.", e
        )
    }
    
    companion object {
        @Volatile
        private var instance: AndroidStorageAdapter? = null

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
            return instance?.context 
                ?: throw IllegalStateException(
                    "NitroStorage not initialized. Call AndroidStorageAdapter.init(this) in your MainApplication.onCreate(), " +
                    "or add 'react-native-nitro-storage' to your Expo plugins array in app.json."
                )
        }
        
        @JvmStatic
        fun setDisk(key: String, value: String) {
            instance?.sharedPreferences?.edit()?.putString(key, value)?.apply()
                ?: throw IllegalStateException(
                    "NitroStorage not initialized. Call AndroidStorageAdapter.init(this) in your MainApplication.onCreate(), " +
                    "or add 'react-native-nitro-storage' to your Expo plugins array in app.json."
                )
        }
        
        @JvmStatic
        fun getDisk(key: String): String? {
            return instance?.sharedPreferences?.getString(key, null)
        }
        
        @JvmStatic
        fun deleteDisk(key: String) {
            instance?.sharedPreferences?.edit()?.remove(key)?.apply()
        }
        
        @JvmStatic
        fun setSecure(key: String, value: String) {
            instance?.encryptedPreferences?.edit()?.putString(key, value)?.apply()
                ?: throw IllegalStateException(
                    "NitroStorage not initialized. Call AndroidStorageAdapter.init(this) in your MainApplication.onCreate(), " +
                    "or add 'react-native-nitro-storage' to your Expo plugins array in app.json."
                )
        }
        
        @JvmStatic
        fun getSecure(key: String): String? {
            return instance?.encryptedPreferences?.getString(key, null)
        }
        
        @JvmStatic
        fun deleteSecure(key: String) {
            instance?.encryptedPreferences?.edit()?.remove(key)?.apply()
        }

        @JvmStatic
        fun clearDisk() {
            instance?.sharedPreferences?.edit()?.clear()?.apply()
        }

        @JvmStatic
        fun clearSecure() {
            instance?.encryptedPreferences?.edit()?.clear()?.apply()
        }
    }
}
