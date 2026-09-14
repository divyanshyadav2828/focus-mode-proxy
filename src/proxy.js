"use strict";

// Disable TLS unauthorized certificate rejection for upstream proxy connections.
// This prevents PROXY_TO_SERVER_REQUEST_ERROR (SELF_SIGNED_CERT_IN_CHAIN, UNABLE_TO_VERIFY_LEAF_SIGNATURE)
// when connecting through corporate networks, SSL inspection proxies, or sites with custom/self-signed certs.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const https = require("https");
if (https.globalAgent && https.globalAgent.options) {
    https.globalAgent.options.rejectUnauthorized = false;
}

const net = require("net");

// Windows fix: 0.0.0.0 is an invalid destination address on Windows and results in ECONNREFUSED.
// http-mitm-proxy internally uses net.connect({ host: "0.0.0.0", port }) to connect to its internal HTTPS server.
// We intercept connection attempts to 0.0.0.0 and redirect them to 127.0.0.1 (localhost).
const origNetConnect = net.connect;
net.connect = function (...args) {
    if (typeof args[0] === "object" && args[0] !== null) {
        if (args[0].host === "0.0.0.0") {
            args[0] = { ...args[0], host: "127.0.0.1" };
        }
    } else if (typeof args[1] === "string" && args[1] === "0.0.0.0") {
        args[1] = "127.0.0.1";
    }
    return origNetConnect.apply(this, args);
};
net.createConnection = net.connect;

const origSocketConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
    if (typeof args[0] === "object" && args[0] !== null) {
        if (args[0].host === "0.0.0.0") {
            args[0] = { ...args[0], host: "127.0.0.1" };
        }
    } else if (typeof args[1] === "string" && args[1] === "0.0.0.0") {
        args[1] = "127.0.0.1";
    }
    return origSocketConnect.apply(this, args);
};

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { Proxy } = require("http-mitm-proxy");
const proxy = new Proxy();

let config;
if (fs.existsSync(path.join(__dirname, "config.js"))) {
    config = require(path.join(__dirname, "config.js"));
} else if (fs.existsSync(path.join(__dirname, "..", "config.js"))) {
    config = require(path.join(__dirname, "..", "config.js"));
} else {
    config = require("../config");
}

const os = require("os");
const CERT_DIR = fs.existsSync(path.join(__dirname, "certs", "ca.crt"))
    ? path.join(__dirname, "certs")
    : path.join(__dirname, "..", "certs");

const CA_CERT = path.join(CERT_DIR, "ca.crt");
const CA_KEY = path.join(CERT_DIR, "ca.key");

if (!fs.existsSync(CA_CERT)) {
    console.error(`CA certificate not found: ${CA_CERT}`);
    process.exit(1);
}

if (!fs.existsSync(CA_KEY)) {
    console.error(`CA private key not found: ${CA_KEY}`);
    process.exit(1);
}

// Enable Wildcard certificate generation (*.domain.com) to minimize certificate overhead
proxy.use(Proxy.wildcard);

// Store ephemeral domain certificates in OS Temp directory to keep project folders clean
const RUNTIME_CERT_DIR = path.join(os.tmpdir(), "NetworkProxy_Certs");
const CERTS_SUBDIR = path.join(RUNTIME_CERT_DIR, "certs");
const KEYS_SUBDIR = path.join(RUNTIME_CERT_DIR, "keys");
if (!fs.existsSync(CERTS_SUBDIR)) fs.mkdirSync(CERTS_SUBDIR, { recursive: true });
if (!fs.existsSync(KEYS_SUBDIR)) fs.mkdirSync(KEYS_SUBDIR, { recursive: true });

const forge = require("node-forge");
const targetCaPem = path.join(CERTS_SUBDIR, "ca.pem");
const targetCaKey = path.join(KEYS_SUBDIR, "ca.private.key");
const targetCaPublicKey = path.join(KEYS_SUBDIR, "ca.public.key");

const caCertContent = fs.readFileSync(CA_CERT, "utf8");
const caKeyContent = fs.readFileSync(CA_KEY, "utf8");

try {
    const privateKey = forge.pki.privateKeyFromPem(caKeyContent);
    const publicKey = forge.pki.setRsaPublicKey(privateKey.n, privateKey.e);
    const publicPem = forge.pki.publicKeyToPem(publicKey);
    fs.writeFileSync(targetCaPublicKey, publicPem);
} catch (e) {
    // If forge fails to derive, try reading ca.crt
    try {
        const certObj = forge.pki.certificateFromPem(caCertContent);
        fs.writeFileSync(targetCaPublicKey, forge.pki.publicKeyToPem(certObj.publicKey));
    } catch (_) {}
}

fs.writeFileSync(targetCaPem, caCertContent);
fs.writeFileSync(targetCaKey, caKeyContent);

/*
|--------------------------------------------------------------------------
| Helpers
|--------------------------------------------------------------------------
*/

function normalizeHost(host) {
    return String(host || "")
        .toLowerCase()
        .replace(/:\d+$/, "")
        .replace(/\.$/, "");
}

function isDomainBlocked(host) {
    host = normalizeHost(host);

    return config.blockedDomains.some(domain => {
        domain = normalizeHost(domain);

        return (
            host === domain ||
            host.endsWith("." + domain)
        );
    });
}

/*
|--------------------------------------------------------------------------
| uBlock Origin Master Adblocker + YouTube Filter Engine
|--------------------------------------------------------------------------
*/

const UBLOCK_CSS = `
/* 1. YouTube Shorts Block */
ytd-guide-entry-renderer:has(a[href^="/shorts"]),
ytd-mini-guide-entry-renderer:has(a[href^="/shorts"]),
ytm-pivot-bar-item-renderer:has(a[href^="/shorts"]),
yt-tab-shape[tab-title="Shorts"],
yt-chip-cloud-chip-renderer:has([title="Shorts"]),
a[title="Shorts"],
a[href^="/shorts"],
ytd-reel-shelf-renderer,
ytd-rich-shelf-renderer[is-shorts],
ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts]),
ytd-rich-section-renderer:has(ytd-reel-shelf-renderer),
ytd-reel-item-renderer,
ytm-reel-shelf-renderer,
ytm-shorts-lockup-view-model,
ytm-shorts-lockup-view-model-v2,
ytd-shorts,
#shorts-container,
#shorts-player,
ytd-reel-video-renderer,

/* 2. Video Player Ads, Overlays & Promos */
.ytp-ad-overlay-container,
.ytp-ad-overlay-slot,
.ytp-ad-message-container,
.ytp-ad-player-overlay,
.ytp-ad-player-overlay-layout,
.ytp-ad-action-interstitial,
.ytp-ad-preview-container,
.ytp-ad-image-overlay,
.ytp-ad-text-overlay,
.ytp-ad-timed-pie-overlay,
.ytp-suggested-action,

/* 3. In-Feed & Search Ads */
ytd-ad-slot-renderer,
ytd-in-feed-ad-layout-renderer,
ytd-promoted-sparkles-web-renderer,
ytd-promoted-sparkles-text-search-renderer,
ytd-promoted-video-renderer,
ytd-rich-item-renderer:has(ytd-ad-slot-renderer),
ytd-rich-item-renderer:has(.ytd-ad-slot-renderer),
ytd-rich-item-renderer:has([id="ad-badge"]),
ytd-rich-section-renderer:has(ytd-ad-slot-renderer),
ytd-search-pyv-renderer,
ytd-banner-promo-renderer,
ytd-statement-banner-renderer,
ytd-display-ad-renderer,
#masthead-ad,
ytd-masthead-ad-v3-renderer,

/* 4. Sidebars, Panels & Companion Ads */
#player-ads,
#panels:has(ytd-ads-engagement-panel-content-renderer),
ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"],
ytd-companion-slot-renderer,
.ytd-action-companion-ad-renderer,
ytd-merch-shelf-renderer,

/* 5. Anti-Adblocker Popups & Premium Upsells */
yt-mealbar-promo-renderer,
ytd-upsell-dialog-renderer,
ytd-popup-container:has(ytd-upsell-dialog-renderer),
tp-yt-paper-dialog:has(#dismiss-button:has(yt-formatted-string:contains("ad block"))),
tp-yt-paper-dialog:has(ytd-enforcement-message-view-model),
ytd-enforcement-message-view-model,
.ytd-popup-container:has(ytd-enforcement-message-view-model) {
    display: none !important;
    visibility: hidden !important;
    height: 0 !important;
    max-height: 0 !important;
    overflow: hidden !important;
    opacity: 0 !important;
    pointer-events: none !important;
}
`;

const UBLOCK_JS = `
(function() {
    'use strict';

    console.log('%c[Skonexa Guard] uBlock Master & Anti-Shorts Engine ACTIVE', 'color: #00ff88; font-weight: bold; font-size: 13px; background: #181818; padding: 4px 8px; border-radius: 4px; border: 1px solid #00ff88;');

    // 1. Instant Player Response Ad Sanitizer
    function sanitizePlayerObj(obj) {
        if (!obj || typeof obj !== 'object') return;
        try {
            delete obj.adPlacements;
            delete obj.playerAds;
            delete obj.adSlots;
            delete obj.adBreakHeartbeatParams;
            if (obj.playbackTracking) {
                delete obj.playbackTracking.videostatsPlaybackUrl;
                delete obj.playbackTracking.videostatsDelayplayUrl;
                delete obj.playbackTracking.videostatsWatchtimeUrl;
                delete obj.playbackTracking.qoeUrl;
                delete obj.playbackTracking.ptrackingUrl;
            }
        } catch (_) {}
    }

    if (window.ytInitialPlayerResponse) {
        sanitizePlayerObj(window.ytInitialPlayerResponse);
    }
    try {
        Object.defineProperty(window, 'ytInitialPlayerResponse', {
            configurable: true,
            set: function(val) {
                sanitizePlayerObj(val);
                this._ytInitialPlayerResponse = val;
            },
            get: function() {
                return this._ytInitialPlayerResponse;
            }
        });
    } catch (_) {}

    // 2. Intercept JSON.parse for YouTube player responses
    var origJsonParse = JSON.parse;
    JSON.parse = function() {
        var res = origJsonParse.apply(this, arguments);
        if (res && typeof res === 'object') {
            if (res.adPlacements || res.playerAds || res.adSlots) {
                sanitizePlayerObj(res);
            }
        }
        return res;
    };

    // 3. Intercept Fetch and XMLHttpRequest for Ad APIs & Shorts
    var origFetch = window.fetch;
    window.fetch = function(input, init) {
        var url = typeof input === 'string' ? input : (input && input.url ? input.url : '');
        if (typeof url === 'string') {
            if (url.indexOf('/youtubei/v1/reel') !== -1 || url.indexOf('/shorts') !== -1) {
                return Promise.reject(new Error('Shorts blocked'));
            }
            if (url.indexOf('/api/stats/ads') !== -1 || url.indexOf('/pagead/') !== -1 || url.indexOf('/ptracking') !== -1) {
                return Promise.resolve(new Response('{}', { status: 200 }));
            }
        }
        return origFetch.apply(this, arguments).then(function(resp) {
            if (typeof url === 'string' && url.indexOf('/youtubei/v1/player') !== -1) {
                return resp.clone().json().then(function(json) {
                    sanitizePlayerObj(json);
                    return new Response(JSON.stringify(json), {
                        status: resp.status,
                        statusText: resp.statusText,
                        headers: resp.headers
                    });
                }).catch(function() { return resp; });
            }
            return resp;
        });
    };

    var origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
        if (typeof url === 'string') {
            if (url.indexOf('/youtubei/v1/reel') !== -1 || url.indexOf('/shorts') !== -1) {
                this.send = function() {};
                return;
            }
            if (url.indexOf('/api/stats/ads') !== -1 || url.indexOf('/pagead/') !== -1) {
                this.send = function() {};
                return;
            }
        }
        return origOpen.apply(this, arguments);
    };

    // 4. Video Ad Fast-Forwarder & Auto-Skipper
    function skipVideoAds() {
        var video = document.querySelector('video.html5-main-video') || document.querySelector('video');
        var player = document.querySelector('#movie_player') || document.querySelector('.html5-video-player');

        var isAdShowing = player && (
            player.classList.contains('ad-showing') ||
            player.classList.contains('ad-interrupting') ||
            document.querySelector('.ytp-ad-player-overlay') !== null ||
            document.querySelector('.ytp-ad-text') !== null
        );

        if (isAdShowing && video) {
            video.muted = true;
            video.playbackRate = 16.0;
            if (isFinite(video.duration) && video.duration > 0) {
                video.currentTime = video.duration;
            }
        }

        // Click skip button immediately
        var skipButtons = document.querySelectorAll(
            '.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button, .ytp-ad-skip-button-text, button.ytp-ad-skip-button-modern, .ytp-ad-overlay-close-button'
        );
        for (var i = 0; i < skipButtons.length; i++) {
            try { skipButtons[i].click(); } catch (_) {}
        }

        // Dismiss anti-adblock popup if present
        var dismissBtn = document.querySelector('tp-yt-paper-dialog #dismiss-button') || document.querySelector('ytd-enforcement-message-view-model #dismiss-button');
        if (dismissBtn) {
            try { dismissBtn.click(); } catch (_) {}
            var dialogs = document.querySelectorAll('tp-yt-paper-dialog:has(ytd-enforcement-message-view-model), tp-yt-paper-dialog:has(#dismiss-button)');
            for (var j = 0; j < dialogs.length; j++) {
                try { dialogs[j].remove(); } catch (_) {}
            }
            if (video && video.paused) {
                try { video.play(); } catch (_) {}
            }
        }
    }

    // 5. Anti-Shorts Redirect & Click Interceptors
    function redirectIfShorts() {
        if (window.location.pathname.startsWith('/shorts') || window.location.pathname.startsWith('/reel')) {
            window.location.replace('/');
        }
    }
    redirectIfShorts();

    document.addEventListener('click', function(e) {
        var target = e.target;
        while (target && target !== document) {
            if (target.tagName === 'A' && target.getAttribute('href') && target.getAttribute('href').startsWith('/shorts')) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                window.location.replace('/');
                return false;
            }
            if (target.getAttribute && (target.getAttribute('is-shorts') !== null || target.getAttribute('title') === 'Shorts')) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                window.location.replace('/');
                return false;
            }
            target = target.parentNode;
        }
    }, true);

    var origPushState = history.pushState;
    history.pushState = function(state, title, url) {
        if (typeof url === 'string' && (url.indexOf('/shorts') !== -1 || url.indexOf('/reel') !== -1)) {
            window.location.replace('/');
            return;
        }
        return origPushState.apply(this, arguments);
    };

    var origReplaceState = history.replaceState;
    history.replaceState = function(state, title, url) {
        if (typeof url === 'string' && (url.indexOf('/shorts') !== -1 || url.indexOf('/reel') !== -1)) {
            window.location.replace('/');
            return;
        }
        return origReplaceState.apply(this, arguments);
    };

    // 6. DOM Cleaner & Periodic Runner
    function cleanDOM() {
        redirectIfShorts();
        skipVideoAds();

        var adElements = document.querySelectorAll(
            'ytd-reel-shelf-renderer, ytd-rich-shelf-renderer[is-shorts], ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts]), ytd-guide-entry-renderer:has(a[href^="/shorts"]), ytd-mini-guide-entry-renderer:has(a[href^="/shorts"]), a[title="Shorts"], a[href^="/shorts"], ytd-shorts, ytm-pivot-bar-item-renderer:has(a[href^="/shorts"]), ytd-ad-slot-renderer, #masthead-ad, ytd-banner-promo-renderer, ytd-statement-banner-renderer'
        );
        for (var i = 0; i < adElements.length; i++) {
            adElements[i].remove();
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', cleanDOM);
    } else {
        cleanDOM();
    }

    setInterval(skipVideoAds, 250);

    var observer = new MutationObserver(cleanDOM);
    observer.observe(document.documentElement, { childList: true, subtree: true });
})();
`;

const UBLOCK_INJECTION = `<style id="skonexa-ublock-css">${UBLOCK_CSS}</style><script id="skonexa-ublock-js">${UBLOCK_JS}</script>`;

function isPathBlocked(host, url, headers) {
    host = normalizeHost(host);

    const pathMatches = config.blockedPaths.some(rule => {
        return (
            rule.host.test(host) &&
            rule.path.test(url)
        );
    });

    if (pathMatches) return true;

    // Check if internal API request originated from Shorts page
    if (headers && headers.referer && /(^|\.)youtube\.com\/shorts/i.test(headers.referer)) {
        if (/^\/youtubei\/v1\/(player|reel|next)/i.test(url)) {
            return true;
        }
    }

    return false;
}

function checkRequest(host, url, headers) {

    if (isDomainBlocked(host)) {
        return {
            blocked: true,
            reason: "DOMAIN_BLOCKED"
        };
    }

    if (isPathBlocked(host, url, headers)) {
        return {
            blocked: true,
            reason: "PATH_BLOCKED"
        };
    }

    return {
        blocked: false
    };
}

function getBlockedHtmlPage(reason, targetUrl) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Access Restricted</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
    <style>
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        :root {
            --red: #e5484d;
            --red-dark: #d13b40;
            --text: #151922;
            --muted: #667085;
            --light: #f8f9fb;
            --border: #e6e8ec;
        }

        html, body {
            min-height: 100%;
        }

        body {
            min-height: 100vh;
            font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            color: var(--text);
            background:
                radial-gradient(circle at 50% 38%,
                    rgba(229, 72, 77, .055),
                    transparent 32%),
                #ffffff;
            display: flex;
            flex-direction: column;
            overflow-x: hidden;
        }

        /* =========================
           HEADER
        ========================= */
        header {
            height: 72px;
            padding: 0 38px;
            display: flex;
            align-items: center;
            justify-content: flex-end;
            background: rgba(255, 255, 255, .92);
            position: relative;
            z-index: 10;
        }

        .security-status {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 7px 13px;
            border: 1px solid #e5e7eb;
            border-radius: 7px;
            color: #667085;
            background: #fff;
            font-size: 11px;
            font-weight: 600;
            letter-spacing: .35px;
            box-shadow: 0 1px 3px rgba(0,0,0,.03);
        }

        .status-dot {
            width: 7px;
            height: 7px;
            border-radius: 50%;
            background: #16a34a;
            box-shadow: 0 0 0 3px rgba(22, 163, 74, .12);
        }

        /* =========================
           MAIN
        ========================= */
        main {
            flex: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 40px 20px;
            position: relative;
            z-index: 10;
        }

        .security-zone {
            width: 100%;
            max-width: 520px;
            text-align: center;
        }

        /* =========================
           PARTICLES
        ========================= */
        #particle-canvas {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            z-index: 1;
            pointer-events: none;
        }

        /* =========================
           SECURITY ICON
        ========================= */
        .security-icon {
            width: 86px;
            height: 86px;
            margin: 0 auto 24px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 50%;
            background: #fff7f7;
            border: 1px solid #ffdfe0;
            box-shadow: 0 12px 35px rgba(229, 72, 77, .08);
            position: relative;
            z-index: 2;
        }

        .security-icon::before,
        .security-icon::after {
            content: '';
            position: absolute;
            inset: -1px;
            border-radius: 50%;
            border: 2px solid rgba(229, 72, 77, 0.4);
            animation: pulse 2s infinite cubic-bezier(0.165, 0.84, 0.44, 1);
            z-index: -1;
        }

        .security-icon::after {
            animation-delay: 1s;
        }

        @keyframes pulse {
            0% {
                transform: scale(1);
                opacity: 1;
            }
            100% {
                transform: scale(1.7);
                opacity: 0;
            }
        }

        .security-icon svg {
            width: 56px;
            height: 56px;
            z-index: 2;
            animation: svgFloat 3s ease-in-out infinite;
        }

        .shield-inner-dashed {
            stroke-dasharray: 4 3;
            animation: dashRotate 10s linear infinite;
        }

        .lock-shackle {
            animation: shackleMove 3s ease-in-out infinite;
            transform-origin: 12px 9px;
        }

        .lock-keyhole {
            animation: keyholePulse 1.5s ease-in-out infinite alternate;
        }

        @keyframes svgFloat {
            0%, 100% { transform: translateY(0) scale(1); }
            50% { transform: translateY(-3px) scale(1.03); }
        }

        @keyframes dashRotate {
            0% { stroke-dashoffset: 0; }
            100% { stroke-dashoffset: -28; }
        }

        @keyframes shackleMove {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-1.5px); }
        }

        @keyframes keyholePulse {
            0% { opacity: 0.5; transform: scale(0.9); }
            100% { opacity: 1; transform: scale(1.1); }
        }

        /* =========================
           LABEL
        ========================= */
        .security-label {
            display: inline-flex;
            align-items: center;
            padding: 6px 12px;
            margin-bottom: 14px;
            border-radius: 6px;
            color: #c9343a;
            background: #fff2f2;
            border: 1px solid #ffdfe0;
            font-size: 11px;
            font-weight: 700;
            letter-spacing: .7px;
            text-transform: uppercase;
        }

        /* =========================
           TITLE & DESCRIPTION
        ========================= */
        h1 {
            font-size: 36px;
            line-height: 1.15;
            letter-spacing: -1.2px;
            font-weight: 800;
            color: var(--text);
            margin-bottom: 12px;
        }

        .description {
            max-width: 420px;
            margin: 0 auto 27px;
            color: var(--muted);
            font-size: 15px;
            line-height: 1.65;
        }

        .close-prompt {
            display: block;
            margin-top: 8px;
            font-weight: 600;
            color: #e5484d;
        }

        /* =========================
           SECURITY PANEL
        ========================= */
        .security-panel {
            width: 100%;
            padding: 14px 18px;
            margin-bottom: 24px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            text-align: left;
            border: 1px solid var(--border);
            border-radius: 10px;
            background: #fafbfc;
            box-shadow: 0 1px 3px rgba(0,0,0,.02);
        }

        .panel-left {
            display: flex;
            align-items: center;
            gap: 12px;
        }

        .lock {
            width: 34px;
            height: 34px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 8px;
            background: #fff;
            border: 1px solid #e7e9ed;
            flex-shrink: 0;
        }

        .lock svg {
            width: 16px;
            height: 16px;
            color: #667085;
        }

        .panel-title {
            font-size: 13px;
            font-weight: 700;
            color: #344054;
        }

        .panel-subtitle {
            margin-top: 2px;
            font-size: 11px;
            color: #98a2b3;
        }

        .denied {
            color: #d92d35;
            font-size: 11px;
            font-weight: 700;
            letter-spacing: .5px;
            text-transform: uppercase;
            padding: 4px 8px;
            background: #fff2f2;
            border-radius: 5px;
        }

        /* =========================
           ACTIONS
        ========================= */
        .actions {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 10px;
        }

        .primary {
            width: 100%;
            max-width: 330px;
            height: 48px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 8px;
            background: var(--red);
            color: #fff;
            text-decoration: none;
            font-size: 15px;
            font-weight: 700;
            border: none;
            cursor: pointer;
            box-shadow: 0 7px 18px rgba(229, 72, 77, .2);
            transition: .18s ease;
        }

        .primary:hover {
            background: var(--red-dark);
            transform: translateY(-1px);
            box-shadow: 0 10px 22px rgba(229, 72, 77, .26);
        }

        .secondary {
            height: 38px;
            padding: 0 18px;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #667085;
            text-decoration: none;
            font-size: 13px;
            font-weight: 600;
            border-radius: 7px;
            transition: .15s ease;
            cursor: pointer;
            border: none;
            background: transparent;
        }

        .secondary:hover {
            background: #f5f6f8;
            color: #344054;
        }

        /* =========================
           FOOTER
        ========================= */
        footer {
            height: 52px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-top: 1px solid #eef0f3;
            color: #667085;
            font-size: 12px;
            font-weight: 500;
            background: #fff;
            position: relative;
            z-index: 10;
        }

        /* =========================
           MOBILE
        ========================= */
        @media (max-width: 600px) {
            header {
                height: 56px;
                padding: 0 20px;
            }
            .security-status {
                font-size: 10px;
            }
            main {
                padding: 30px 20px;
            }
            .security-icon {
                width: 76px;
                height: 76px;
            }
            .security-icon svg {
                width: 48px;
                height: 48px;
            }
            h1 {
                font-size: 28px;
            }
            .description {
                font-size: 14px;
            }
            .security-panel {
                padding: 12px;
            }
            footer {
                height: 48px;
                font-size: 11px;
            }
        }
    </style>
</head>
<body>
    <canvas id="particle-canvas"></canvas>

    <header>
        <div class="security-status">
            <span class="status-dot"></span> Web Filter Policy Active
        </div>
    </header>

    <main>
        <section class="security-zone">
            <!-- SECURITY ICON -->
            <div class="security-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="#e5484d" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                    <!-- Outer Shield -->
                    <path class="shield-outer" d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke-width="2"></path>
                    <!-- Inner Dashed Shield -->
                    <path class="shield-inner-dashed" d="M12 20c-3.5-1.5-6-4.5-6-8V6.5l6-2.2 6 2.2V12c0 3.5-2.5 6.5-6 8z" stroke="#e5484d" stroke-width="0.75" stroke-dasharray="3 3"></path>
                    <!-- Lock Shackle -->
                    <path class="lock-shackle" d="M10 11V9a2 2 0 1 1 4 0v2"></path>
                    <!-- Lock Body -->
                    <rect class="lock-body" x="8" y="11" width="8" height="5" rx="1" fill="#e5484d" stroke="none"></rect>
                    <!-- Keyhole -->
                    <circle class="lock-keyhole" cx="12" cy="13.5" r="1" fill="#fff" stroke="none"></circle>
                </svg>
            </div>

            <!-- LABEL -->
            <div class="security-label">
                Security Alert
            </div>

            <!-- TITLE -->
            <h1>Access Restricted</h1>

            <p class="description">
                This protected resource isn't available under your network policy.
                <span class="close-prompt">Please close this tab to continue.</span>
            </p>

            <!-- SECURITY STATUS PANEL -->
            <div class="security-panel">
                <div class="panel-left">
                    <div class="lock">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="3" y="11" width="18" height="10" rx="2"></rect>
                            <path d="M7 11V7 C7 4.2 9.2 2 12 2 C14.8 2 17 4.2 17 7V11"></path>
                        </svg>
                    </div>
                    <div>
                        <div class="panel-title">Protected Resource</div>
                        <div class="panel-subtitle">Network authorization enforced</div>
                    </div>
                </div>
                <div class="denied">
                    Access Denied
                </div>
            </div>

            <!-- ACTIONS -->
            <div class="actions">
                <button onclick="window.close(); history.back();" class="primary">
                    Close This Tab
                </button>
                <button onclick="history.back();" class="secondary">
                    Go Back
                </button>
            </div>
        </section>
    </main>

    <footer>
        Network tool Developed By Divyansh yadav
    </footer>

    <script>
        (function() {
            var canvas = document.getElementById('particle-canvas');
            if (!canvas) return;
            var ctx = canvas.getContext('2d');
            var particles = [];
            var width, height;

            function resize() {
                width = canvas.width = window.innerWidth;
                height = canvas.height = window.innerHeight;
            }
            window.addEventListener('resize', resize);
            resize();

            for (var i = 0; i < 45; i++) {
                particles.push({
                    x: Math.random() * width,
                    y: Math.random() * height,
                    vx: (Math.random() - 0.5) * 0.7,
                    vy: (Math.random() - 0.5) * 0.7,
                    radius: Math.random() * 2 + 1
                });
            }

            function animate() {
                ctx.clearRect(0, 0, width, height);
                for (var i = 0; i < particles.length; i++) {
                    var p = particles[i];
                    p.x += p.vx;
                    p.y += p.vy;
                    if (p.x < 0 || p.x > width) p.vx *= -1;
                    if (p.y < 0 || p.y > height) p.vy *= -1;

                    ctx.beginPath();
                    ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
                    ctx.fillStyle = 'rgba(229, 72, 77, 0.35)';
                    ctx.fill();

                    for (var j = i + 1; j < particles.length; j++) {
                        var p2 = particles[j];
                        var dx = p.x - p2.x;
                        var dy = p.y - p2.y;
                        var dist = Math.sqrt(dx * dx + dy * dy);
                        if (dist < 130) {
                            ctx.beginPath();
                            ctx.moveTo(p.x, p.y);
                            ctx.lineTo(p2.x, p2.y);
                            ctx.strokeStyle = 'rgba(229, 72, 77, ' + (0.16 * (1 - dist / 130)) + ')';
                            ctx.lineWidth = 0.8;
                            ctx.stroke();
                        }
                    }
                }
                requestAnimationFrame(animate);
            }
            animate();
        })();
    </script>
</body>
</html>`;
}

/*
|--------------------------------------------------------------------------
| Proxy request handler
|--------------------------------------------------------------------------
*/

proxy.onRequest((ctx, callback) => {

    const req = ctx.clientToProxyRequest;

    const host = normalizeHost(
        req.headers.host
    );

    const url = req.url || "/";

    const result = checkRequest(
        host,
        url,
        req.headers
    );

    console.log(
        `[${result.blocked ? "BLOCK" : "ALLOW"}] ` +
        `${req.method} ${host}${url}`
    );

    if (result.blocked) {

        const response =
            ctx.proxyToClientResponse;

        const isApiRequest = url.includes("/youtubei/v1/") || (req.headers.accept && req.headers.accept.includes("application/json"));

        if (isApiRequest) {
            response.writeHead(403, {
                "Content-Type": "application/json; charset=utf-8",
                "Cache-Control": "no-store"
            });
            response.end(JSON.stringify({
                error: {
                    code: 403,
                    message: "YouTube Shorts has been blocked by network policy."
                }
            }));
            return;
        }

        response.writeHead(403, {
            "Content-Type":
                "text/html; charset=utf-8",

            "Cache-Control":
                "no-store"
        });

        response.end(getBlockedHtmlPage(result.reason, `${host}${url}`));

        return;
    }

    // Ensure proxyToServerRequest never rejects self-signed / corporate upstream certs
    if (ctx.proxyToServerRequestOptions) {
        ctx.proxyToServerRequestOptions.rejectUnauthorized = false;
    }

    ctx.onRequestHeaders((ctx, cb) => {
        if (ctx.proxyToServerRequestOptions) {
            ctx.proxyToServerRequestOptions.rejectUnauthorized = false;
        }
        return cb();
    });

    // If request is to YouTube, inject uBlock Master & Anti-Shorts into HTML pages
    if (/(^|\.)youtube\.com$/i.test(host)) {
        // Force server to respond with gzip or identity
        if (ctx.proxyToServerRequestOptions && ctx.proxyToServerRequestOptions.headers) {
            ctx.proxyToServerRequestOptions.headers["accept-encoding"] = "gzip";
        }

        ctx.onResponse((ctx, cb) => {
            if (ctx.serverToProxyResponse && ctx.serverToProxyResponse.headers) {
                // Strip CSP to permit injected inline script & style
                delete ctx.serverToProxyResponse.headers["content-security-policy"];
                delete ctx.serverToProxyResponse.headers["content-security-policy-report-only"];

                const encoding = (ctx.serverToProxyResponse.headers["content-encoding"] || "").toLowerCase();
                const contentType = (ctx.serverToProxyResponse.headers["content-type"] || "").toLowerCase();

                if (contentType.includes("text/html")) {
                    ctx.isHtml = true;

                    if (encoding === "gzip") {
                        delete ctx.serverToProxyResponse.headers["content-encoding"];
                        ctx.addResponseFilter(zlib.createGunzip());
                    } else if (encoding === "br") {
                        delete ctx.serverToProxyResponse.headers["content-encoding"];
                        ctx.addResponseFilter(zlib.createBrotliDecompress());
                    } else if (encoding === "deflate") {
                        delete ctx.serverToProxyResponse.headers["content-encoding"];
                        ctx.addResponseFilter(zlib.createInflate());
                    }
                }
            }
            return cb();
        });

        let injected = false;
        ctx.onResponseData((ctx, chunk, cb) => {
            if (ctx.isHtml && !injected) {
                let html = chunk.toString("utf8");
                if (html.includes("<head>")) {
                    html = html.replace("<head>", "<head>" + UBLOCK_INJECTION);
                    chunk = Buffer.from(html, "utf8");
                    injected = true;
                    console.log(`[INJECT] uBlock Master & Anti-Shorts injected into ${host}${url}`);
                } else if (/<head[^>]*>/i.test(html)) {
                    html = html.replace(/<head[^>]*>/i, "$&" + UBLOCK_INJECTION);
                    chunk = Buffer.from(html, "utf8");
                    injected = true;
                    console.log(`[INJECT] uBlock Master & Anti-Shorts injected into ${host}${url}`);
                } else if (html.includes("<html") || html.includes("<!DOCTYPE") || html.includes("<!doctype")) {
                    html = UBLOCK_INJECTION + html;
                    chunk = Buffer.from(html, "utf8");
                    injected = true;
                    console.log(`[INJECT] uBlock Master & Anti-Shorts prepended to HTML ${host}${url}`);
                }
            }
            return cb(null, chunk);
        });
    }

    callback();
});

/*
|--------------------------------------------------------------------------
| Error handling
|--------------------------------------------------------------------------
*/

proxy.onError((ctx, err, kind) => {
    const code = err?.code || "";
    const msg = err?.message || "";

    // Ignore benign client socket timeouts and server client-drop events
    if (kind === "HTTPS_CLIENT_ERROR" || kind === "HTTPS_SERVER_ERROR") {
        return;
    }

    // Ignore benign socket reset / timeout / upstream certificate verification errors
    if (
        code === "ECONNRESET" ||
        code === "EPIPE" ||
        code === "ETIMEDOUT" ||
        code === "ERR_HTTP_REQUEST_TIMEOUT" ||
        code === "SELF_SIGNED_CERT_IN_CHAIN" ||
        code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" ||
        code === "DEPTH_ZERO_SELF_SIGNED_CERT" ||
        code === "CERT_HAS_EXPIRED" ||
        msg.includes("ECONNRESET") ||
        msg.includes("Request timeout") ||
        msg.includes("self-signed certificate") ||
        msg.includes("unable to verify")
    ) {
        // Send a clean 502/504 error to client if response is still pending
        try {
            if (ctx && ctx.proxyToClientResponse && !ctx.proxyToClientResponse.headersSent) {
                const status = code.includes("TIMEOUT") ? 504 : 502;
                ctx.proxyToClientResponse.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
                ctx.proxyToClientResponse.end(`Proxy Gateway (${code || "NETWORK_NOTICE"}): ${msg}`);
            }
        } catch (_) {}
        return;
    }

    if (code === "ERR_SSL_SSLV3_ALERT_CERTIFICATE_UNKNOWN" || msg.includes("certificate unknown")) {
        console.warn("[PROXY SSL WARNING] Client rejected MITM certificate (SSL alert 46). Make sure ca.crt is installed in Windows/Browser Trusted Root Authorities.");
        return;
    }

    console.error(
        `[PROXY ERROR${kind ? " - " + kind : ""}]`,
        msg || err
    );
});

/*
|--------------------------------------------------------------------------
| Start proxy
|--------------------------------------------------------------------------
*/

proxy.listen({
    port: config.port,
    host: config.host || "0.0.0.0",

    sslCaDir: RUNTIME_CERT_DIR,

    sslCaCert: fs.readFileSync(
        CA_CERT
    ),

    sslCaKey: fs.readFileSync(
        CA_KEY
    )
}, (err) => {
    if (err) {
        console.error("[PROXY FATAL ERROR] Failed to start proxy server:", err);
        process.exit(1);
    }

    console.log(`
================================================================
           Network Web Filter Proxy (Running)
              Developed by Divyansh Yadav
================================================================

 [✓] HTTP Proxy Port : ${config.port}
 [✓] HTTPS MITM      : ENABLED (Root CA Synced)
 [✓] CA Certificate  : ${CA_CERT}
 [✓] Protection      : YouTube Shorts Blocked + uBlock Origin Engine

================================================================
`);
});