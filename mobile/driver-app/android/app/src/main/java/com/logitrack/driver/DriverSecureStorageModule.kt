package com.logitrack.driver

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Stores driver credentials encrypted by a non-exportable Android Keystore key.
 * This is intentionally mobile-only and avoids placing bearer tokens in AsyncStorage.
 */
class DriverSecureStorageModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private val preferences = context.getSharedPreferences("aab_driver_secure_storage", 0)
  private val keyAlias = "aab_driver_auth_key"

  override fun getName(): String = "DriverSecureStorage"

  private fun getOrCreateKey(): SecretKey {
    val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (keyStore.getKey(keyAlias, null) as? SecretKey)?.let { return it }
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    generator.init(
      KeyGenParameterSpec.Builder(
        keyAlias,
        KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
      )
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .build(),
    )
    return generator.generateKey()
  }

  @ReactMethod
  fun setItem(key: String, value: String, promise: Promise) {
    try {
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
      val encrypted = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
      val payload = "${Base64.encodeToString(cipher.iv, Base64.NO_WRAP)}:${Base64.encodeToString(encrypted, Base64.NO_WRAP)}"
      preferences.edit().putString(key, payload).apply()
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("SECURE_STORAGE_WRITE_FAILED", "Unable to protect the driver credential.", error)
    }
  }

  @ReactMethod
  fun getItem(key: String, promise: Promise) {
    try {
      val payload = preferences.getString(key, null)
      if (payload.isNullOrBlank()) {
        promise.resolve(null)
        return
      }
      val parts = payload.split(":", limit = 2)
      if (parts.size != 2) throw IllegalStateException("Invalid encrypted credential payload")
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(
        Cipher.DECRYPT_MODE,
        getOrCreateKey(),
        GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)),
      )
      val decrypted = cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP))
      promise.resolve(String(decrypted, Charsets.UTF_8))
    } catch (error: Exception) {
      // A corrupt/undecryptable credential must never be returned or silently reused.
      preferences.edit().remove(key).apply()
      promise.reject("SECURE_STORAGE_READ_FAILED", "Unable to read the protected driver credential.", error)
    }
  }

  @ReactMethod
  fun deleteItem(key: String, promise: Promise) {
    preferences.edit().remove(key).apply()
    promise.resolve(null)
  }
}
