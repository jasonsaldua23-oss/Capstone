package com.logitrack.driver;

import android.os.Bundle;
import android.content.Intent;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.PluginHandle;
import ee.forgr.capacitor.social.login.GoogleProvider;
import ee.forgr.capacitor.social.login.SocialLoginPlugin;
import ee.forgr.capacitor.social.login.ModifiedMainActivityForSocialLoginPlugin;

/**
 * The social-login plugin requires this marker before it accepts explicit Google
 * scopes. The customer shell loads the portal remotely, so the native marker also
 * protects it while a CDN is still serving an older web bundle.
 */
public class MainActivity extends BridgeActivity implements ModifiedMainActivityForSocialLoginPlugin {

    @Override
    public void IHaveModifiedTheMainActivityForTheUseWithSocialLoginPlugin() {
        // Marker required by @capgo/capacitor-social-login for Google scopes.
    }

    @Override
    public void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        // Fix: Google's consent resolution must complete the pending native login,
        // including cancellation; the marker interface alone does not forward it.
        if (requestCode >= GoogleProvider.REQUEST_AUTHORIZE_GOOGLE_MIN
                && requestCode < GoogleProvider.REQUEST_AUTHORIZE_GOOGLE_MAX && bridge != null) {
            PluginHandle handle = bridge.getPlugin("SocialLogin");
            if (handle != null && handle.getInstance() instanceof SocialLoginPlugin login) {
                login.handleGoogleLoginIntent(requestCode, data == null ? new Intent() : data);
            }
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Register before the bridge loads the driver portal.
        registerPlugin(DriverTrackingPlugin.class);
        registerPlugin(DriverSpeechPlugin.class);
        super.onCreate(savedInstanceState);

        // Each build is one portal: replace the default client with the one that
        // refuses to navigate anywhere else on the shared host. The bridge is null
        // only on a device with no usable web view, where there is nothing to guard.
        if (this.bridge != null) {
            this.bridge.setWebViewClient(new PortalWebViewClient(this.bridge));
        }
    }
}
