# Network Web Filter Proxy

> **High-Performance HTTP / HTTPS MITM Web Filtering Proxy**  
> Developed by **Divyansh Yadav**

---

## 🚀 Overview

**Network Web Filter Proxy** is a comprehensive, standalone network proxy and content filtering solution designed for Windows environments. It intercepts HTTP and HTTPS traffic through a dedicated Root Certificate Authority (MITM), enforcing fine-grained domain and URL path filtering, complete YouTube Shorts blocking, and embedded ad-blocking using the uBlock Origin Master engine.

The project provides both a **portable single-file executable (`.exe`)** requiring zero installation and a **Windows Installer package (`.msi`)** for enterprise deployment.

---

## ✨ Key Features

- 🛑 **Complete YouTube Shorts Blocking**:
  - Intercepts and blocks direct YouTube Shorts URLs (`/shorts/*`).
  - Blocks internal YouTube backend player and reel APIs (`/youtubei/v1/reel/*`, `/youtubei/v1/player`).
  - Injects client-side DOM cleanup scripts removing Shorts buttons, navigation tabs, and reels.

- 🛡️ **Injected uBlock Origin Ad-Blocking Engine**:
  - Injects ad-sanitizing JavaScript directly into web page responses.
  - Automatically neutralizes pre-roll/mid-roll video ads, banner ads, and tracking telemetry.
  - Dismisses anti-adblock dialogs and bypasses YouTube ad enforcement seamlessly.

- 🔒 **Granular URL Path & Domain Filtering**:
  - Configurable domain allowlists and blocklists via [`config.js`](file:///c:/Users/IS/Desktop/VIDYAGYAN_PORTALS/skonexa-proxy/config.js).
  - Exact URL path blocking (e.g., blocking `https://sites.google.com/view/drive-u-7-home/home` while allowing the rest of `sites.google.com`).

- 🎨 **Custom 403 "Access Restricted" Page**:
  - Sleek dark-mode restriction page featuring a dynamic HTML5 particles canvas animation and security shield icon.
  - Clear user guidance with custom branding: `Network tool Developed By Divyansh Yadav`.

- ⚡ **Windows `0.0.0.0` Socket Patch**:
  - Automatic low-level socket interception redirecting internal proxy connections from `0.0.0.0` to `127.0.0.1`, completely preventing Windows `ECONNREFUSED` errors.

- 🌐 **Corporate SSL Inspection & Self-Signed Cert Support**:
  - Automatically bypasses upstream `SELF_SIGNED_CERT_IN_CHAIN` errors for corporate networks, antivirus SSL scanners, and school firewalls.

- 📦 **Zero-Install Portable `.exe` & `.msi` Windows Installer**:
  - **Standalone `.exe`**: 100% self-contained portable executable with embedded Node.js runtime and certificates — double-click to run instantly anywhere.
  - **`.msi` Installer**: Enterprise installer creating Desktop & Start Menu shortcuts and automatic certificate installation.

---

## 📁 Repository Structure

```
skonexa-proxy/
├── certs/                      # Root CA certificate & keys
│   ├── ca.crt                  # Public Root CA certificate
│   ├── ca.key                  # Root CA private key
│   ├── certs/                  # Generated domain certificates
│   └── keys/                   # Generated domain private keys
├── config.js                   # Proxy configuration (allowed/blocked domains & paths)
├── network_app/                # Pre-built distribution binaries
│   ├── NetworkWebFilterProxy.exe  # Standalone instant-run executable (Zero install)
│   ├── NetworkWebFilterProxy.msi  # Windows Installer package
│   ├── Start_Proxy_Console.cmd    # Quick console launcher
│   ├── Start_Proxy_Background.vbs # Silent background runner
│   └── Install_Certificate.cmd    # Root CA installer
├── package.json                # Project manifest & npm scripts
├── scripts/
│   ├── build_exe.js            # Standalone C# .exe builder (embeds zip payload)
│   ├── build_msi.js            # Windows Installer .msi database builder
│   ├── Program.cs              # C# native launcher wrapper
│   └── verify_msi.js           # MSI table & stream verification script
├── src/
│   └── proxy.js                # Core MITM proxy server and filtering engine
└── .gitignore                  # Git ignore rules
```

---

## 🛠️ Getting Started

### Prerequisites
- Windows 10 / 11 or Windows Server
- [Node.js](https://nodejs.org/) (v18+ recommended for development; not required for running the `.exe`)

### Quick Start (Development)
1. Clone the repository and install dependencies:
   ```bash
   git clone <repo-url>
   cd skonexa-proxy
   npm install
   ```

2. Start the proxy server:
   ```bash
   npm start
   ```

3. Configure your browser or Windows proxy settings:
   - **Address**: `127.0.0.1` (or `localhost`)
   - **Port**: `8085`

4. Install the Root Certificate:
   - Double-click [`certs/ca.crt`](file:///c:/Users/IS/Desktop/VIDYAGYAN_PORTALS/skonexa-proxy/certs/ca.crt) and install it into **Trusted Root Certification Authorities**.

---

## 📦 Building Standalone Binaries

| Command | Output | Description |
| :--- | :--- | :--- |
| `npm run build:exe` | `network_app/NetworkWebFilterProxy.exe` | Compiles a standalone single-file `.exe` with embedded Node runtime and auto-cert trust |
| `npm run build:msi` | `network_app/NetworkWebFilterProxy.msi` | Generates a standard Windows `.msi` installer with shortcuts |
| `npm run build:all` | Both `.exe` and `.msi` | Rebuilds both distribution artifacts |
| `npm run verify:msi`| Console report | Inspects and validates the `.msi` tables and embedded cabinet streams |

---

## ⚙️ Configuration

Edit [`config.js`](file:///c:/Users/IS/Desktop/VIDYAGYAN_PORTALS/skonexa-proxy/config.js) to customize proxy behavior:

```javascript
module.exports = {
    port: 8085,
    host: "0.0.0.0",

    // Allowed domains (regex or exact hostname)
    allowedDomains: [
        /(^|\.)youtube\.com$/i,
        /(^|\.)sites\.google\.com$/i,
        /(^|\.)google\.com$/i,
    ],

    // Blocked URL paths
    blockedPaths: [
        /^\/shorts(\/.*)?$/i,
        /^\/youtubei\/v1\/reel\//i,
        /^\/view\/drive-u-7-home(\/.*)?$/i
    ]
};
```

---

## 👤 Author

**Divyansh Yadav**
