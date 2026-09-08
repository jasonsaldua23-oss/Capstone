package com.logitrack.driver;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;
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
    protected void onCreate(Bundle savedInstanceState) {
        // Register before the bridge loads the driver portal.
        registerPlugin(DriverTrackingPlugin.class);
        super.onCreate(savedInstanceState);

        // Each build is one portal: replace the default client with the one that
        // refuses to navigate anywhere else on the shared host. The bridge is null
        // only on a device with no usable web view, where there is nothing to guard.
        if (this.bridge != null) {
            this.bridge.setWebViewClient(new PortalWebViewClient(this.bridge));
        }
    }
}
