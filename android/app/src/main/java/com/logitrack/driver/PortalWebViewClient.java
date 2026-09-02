package com.logitrack.driver;

import android.net.Uri;
import android.text.TextUtils;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;

import java.util.Locale;

/**
 * Confines the shell to the one portal it was packaged for.
 *
 * The apps load the deployed site instead of a bundled copy, and all four portals -
 * admin, warehouse, driver and customer - live on the same host. Capacitor's
 * `allowNavigation` filters hosts only, so on its own it would happily let the
 * Driver app open the Shop login. This client filters by path as well: a main-frame
 * navigation that leaves the portal is refused and the web view is sent back to its
 * own login page.
 *
 * The portal is taken from the server URL in capacitor.config.json, which
 * `npx cap sync` writes from the APP_VARIANT used for the build, so the two can
 * never drift apart. Client-side routing inside the single-page app never reaches
 * this class; portal-lock.ts covers that, and the server middleware covers what is
 * requested over the network.
 */
public class PortalWebViewClient extends BridgeWebViewClient {

    private final String portal;
    private final String host;
    private final String homeUrl;

    public PortalWebViewClient(Bridge bridge) {
        super(bridge);

        String serverUrl = bridge.getConfig().getServerUrl();
        Uri configured = TextUtils.isEmpty(serverUrl) ? null : Uri.parse(serverUrl);

        this.host = configured == null ? null : configured.getHost();
        this.portal = portalFromPath(configured == null ? null : configured.getPath());
        this.homeUrl = configured == null || this.portal == null
            ? serverUrl
            : configured.buildUpon().path("/" + this.portal + "/login").query(null).fragment(null).build().toString();
    }

    @Override
    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        if (request.isForMainFrame() && isOutOfPortal(request.getUrl())) {
            sendHome(view);
            return true;
        }
        return super.shouldOverrideUrlLoading(view, request);
    }

    @Deprecated
    @Override
    public boolean shouldOverrideUrlLoading(WebView view, String url) {
        if (isOutOfPortal(Uri.parse(url))) {
            sendHome(view);
            return true;
        }
        return super.shouldOverrideUrlLoading(view, url);
    }

    private void sendHome(final WebView view) {
        if (TextUtils.isEmpty(homeUrl)) {
            return;
        }
        // Loading from inside shouldOverrideUrlLoading is not allowed; post it instead.
        view.post(new Runnable() {
            @Override
            public void run() {
                view.loadUrl(homeUrl);
            }
        });
    }

    /**
     * Only same-host navigations are judged here. A different host is left to the
     * bridge, which already opens it externally or blocks it per allowNavigation.
     */
    private boolean isOutOfPortal(Uri url) {
        if (portal == null || host == null || url == null) {
            return false;
        }
        if (!host.equalsIgnoreCase(url.getHost())) {
            return false;
        }
        return !isPathAllowed(url.getPath());
    }

    /** Mirrors isPathAllowedForPortal() in src/lib/portal-scope.ts. */
    private boolean isPathAllowed(String rawPath) {
        String path = normalise(rawPath);

        if (path.equals("/") || path.equals("/manifest.webmanifest") || path.equals("/push-sw.js") || path.equals("/favicon.ico")) {
            return true;
        }
        if (path.startsWith("/api/") || path.startsWith("/uploads/") || path.startsWith("/_next/")) {
            return true;
        }

        // Fix: the portal prefix mirrors the manifest scope and excludes the
        // other installed portal while still allowing all of this portal's pages.
        String ownScope = "/" + portal;
        if (path.equals(ownScope) || path.startsWith(ownScope + "/")) {
            return true;
        }

        // Allow legacy login URLs so the server can redirect old bookmarks.
        String legacyLogin = "/login/" + portal;
        if (path.equals(legacyLogin) || path.startsWith(legacyLogin + "/")) {
            return true;
        }

        // Static files - icons, images, map data - are shared by every portal.
        return !path.startsWith("/login") && path.matches(".*\\.[A-Za-z0-9]+$");
    }

    private static String normalise(String rawPath) {
        if (TextUtils.isEmpty(rawPath)) {
            return "/";
        }
        String path = rawPath;
        if (path.length() > 1 && path.endsWith("/")) {
            path = path.substring(0, path.length() - 1);
        }
        return TextUtils.isEmpty(path) ? "/" : path;
    }

    /** "/driver/login" (and legacy "/login/driver") -> "driver". */
    private static String portalFromPath(String rawPath) {
        String path = normalise(rawPath).toLowerCase(Locale.US);
        for (String candidate : new String[] { "admin", "warehouse", "driver", "customer" }) {
            String scopedLogin = "/" + candidate + "/login";
            String legacyLogin = "/login/" + candidate;
            if (path.equals(scopedLogin) || path.startsWith(scopedLogin + "/") ||
                path.equals(legacyLogin) || path.startsWith(legacyLogin + "/")) {
                return candidate;
            }
        }
        return null;
    }
}
