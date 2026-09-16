module.exports = {
    port: 8085,
    host: "0.0.0.0",

    // Domains that are allowed normally
    allowedDomains: [
        "youtube.com",
        "www.youtube.com",
        "sites.google.com",
        "script.google.com",
        "googleusercontent.com"
    ],

    // Blocked search/URL keywords on YouTube
    blockedKeywords: [
        "game",
        "games",
        "belly",
        "dance"
    ],

    // URL path rules
    blockedPaths: [
        {
            host: /(^|\.)youtube\.com$/i,
            path: /^\/(shorts|reel|feed\/shorts|hashtag\/shorts?)(\/|\?|$)/i
        },
        {
            host: /(^|\.)youtube\.com$/i,
            path: /^\/youtubei\/v1\/reel(\/|$)/i
        },
        {
            host: /(^|\.)youtube\.com$/i,
            path: /^\/(api\/stats\/ads|pagead\/|ptracking|youtubei\/v1\/player\/ad_break)/i
        },
        {
            host: /(^|\.)sites\.google\.com$/i,
            path: /^\/view\/drive-u-7-home(\/|\?|$)/i
        },
        {
            host: /(^|\.)script\.google\.com$/i,
            path: /^\/macros\/s\/AKfycbxEe5cHpL6kAQ2UYdjqkYm6n6UoNA9bEa6uOzmBgUbrWzMZ4h3GIXmq6xunj9NtUzPS(\/|\?|$)/i
        }
    ],

    // Complete ad & tracking domain blocks
    blockedDomains: [
        "doubleclick.net",
        "googleadservices.com",
        "googlesyndication.com",
        "adservice.google.com"
    ]
};