package com.logitrack.driver;

import android.media.AudioAttributes;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.Locale;

/** Android WebView has no reliable Web Speech synthesis; use the device's TTS engine. */
@CapacitorPlugin(name = "DriverSpeech")
public class DriverSpeechPlugin extends Plugin {
    private final Handler main = new Handler(Looper.getMainLooper());
    private TextToSpeech speech;
    private PluginCall pending;
    private boolean ready;
    private int generation;

    private final Runnable initTimeout = () -> {
        if (!ready) {
            rejectPending("Voice guidance could not start. Check the device's text-to-speech settings.");
            shutdown();
        }
    };

    @PluginMethod public void speak(PluginCall call) {
        main.post(() -> {
            String text = call.getString("text", "").trim();
            if (text.isEmpty()) { call.resolve(); return; }
            // Keep only the newest maneuver while the engine is starting.
            if (pending != null) pending.resolve();
            pending = call;
            if (ready) { speakPending(); return; }
            if (speech != null) return;
            int startingGeneration = ++generation;
            main.postDelayed(initTimeout, 8000);
            speech = new TextToSpeech(getContext(), status -> main.post(() -> {
                if (startingGeneration != generation || speech == null) return;
                main.removeCallbacks(initTimeout);
                if (status != TextToSpeech.SUCCESS) {
                    rejectPending("Enable a text-to-speech engine in the device settings for voice guidance.");
                    shutdown();
                    return;
                }
                int language = speech.setLanguage(Locale.forLanguageTag("en-PH"));
                if (language < TextToSpeech.LANG_AVAILABLE) language = speech.setLanguage(Locale.US);
                if (language < TextToSpeech.LANG_AVAILABLE) {
                    rejectPending("Install an English text-to-speech voice in the device settings.");
                    shutdown();
                    return;
                }
                speech.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build());
                speech.setSpeechRate(1f);
                ready = true;
                speakPending();
            }));
        });
    }

    private void speakPending() {
        if (pending == null) return;
        PluginCall call = pending;
        pending = null;
        // A new turn replaces an obsolete instruction instead of building a delayed queue.
        int result = speech.speak(call.getString("text", ""), TextToSpeech.QUEUE_FLUSH, null, "driver-turn");
        if (result == TextToSpeech.ERROR) call.reject("Voice guidance could not play. Check text-to-speech settings.");
        else call.resolve();
    }

    private void rejectPending(String message) {
        if (pending != null) { pending.reject(message); pending = null; }
    }

    @PluginMethod public void stop(PluginCall call) {
        main.post(() -> {
            if (pending != null) { pending.resolve(); pending = null; }
            if (speech != null) speech.stop();
            call.resolve();
        });
    }

    private void shutdown() {
        generation++;
        main.removeCallbacks(initTimeout);
        ready = false;
        if (speech != null) { speech.stop(); speech.shutdown(); speech = null; }
    }

    @Override protected void handleOnDestroy() {
        main.post(() -> {
            rejectPending("Voice guidance was closed.");
            shutdown();
        });
    }
}
