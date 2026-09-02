package com.logitrack.driver;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Each build is one portal: replace the default client with the one that
        // refuses to navigate anywhere else on the shared host. The bridge is null
        // only on a device with no usable web view, where there is nothing to guard.
        if (this.bridge != null) {
            this.bridge.setWebViewClient(new PortalWebViewClient(this.bridge));
        }
    }
}
