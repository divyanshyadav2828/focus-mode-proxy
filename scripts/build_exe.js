"use strict";

const fs = require("fs");
const path = require("path");
const cp = require("child_process");

console.log("==================================================");
console.log("    Building Standalone Network Web Filter EXE   ");
console.log("==================================================");

const ROOT_DIR = path.resolve(__dirname, "..");
const STAGING_DIR = path.join(ROOT_DIR, "build_staging");
const OUTPUT_DIR = path.join(ROOT_DIR, "network_app");
const EXE_PATH = path.join(OUTPUT_DIR, "NetworkWebFilterProxy.exe");
const ZIP_PATH = path.join(ROOT_DIR, "app_payload.zip");
const CS_PATH = path.join(__dirname, "Program.cs");
const CSC_COMPILER = "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe";

// 1. Prepare Staging Directory
console.log("[1/4] Preparing application staging bundle...");
if (fs.existsSync(STAGING_DIR)) fs.rmSync(STAGING_DIR, { recursive: true, force: true });
if (fs.existsSync(ZIP_PATH)) fs.unlinkSync(ZIP_PATH);
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

fs.mkdirSync(STAGING_DIR, { recursive: true });

// Copy standalone node.exe runtime
console.log(`- Bundling standalone Node runtime from ${process.execPath}...`);
fs.copyFileSync(process.execPath, path.join(STAGING_DIR, "node.exe"));

// Copy app files
fs.copyFileSync(path.join(ROOT_DIR, "src", "proxy.js"), path.join(STAGING_DIR, "proxy.js"));
fs.copyFileSync(path.join(ROOT_DIR, "config.js"), path.join(STAGING_DIR, "config.js"));
fs.copyFileSync(path.join(ROOT_DIR, "package.json"), path.join(STAGING_DIR, "package.json"));

// Recursive copy helper
function copyDirRecursive(src, dest) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyDirRecursive(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

console.log("- Bundling certificates...");
copyDirRecursive(path.join(ROOT_DIR, "certs"), path.join(STAGING_DIR, "certs"));

console.log("- Bundling node_modules...");
copyDirRecursive(path.join(ROOT_DIR, "node_modules"), path.join(STAGING_DIR, "node_modules"));

// 2. Compress Staging into ZIP
console.log("[2/4] Compressing application payload into ZIP...");
const psCompress = cp.spawnSync("powershell", [
    "-NoProfile",
    "-Command",
    `Compress-Archive -Path '${STAGING_DIR}\\*' -DestinationPath '${ZIP_PATH}' -CompressionLevel Optimal`
], { encoding: "utf8" });

if (psCompress.status !== 0 || !fs.existsSync(ZIP_PATH)) {
    console.error("Compression failed:", psCompress.stderr || psCompress.stdout);
    process.exit(1);
}

const zipSizeMB = (fs.statSync(ZIP_PATH).size / 1024 / 1024).toFixed(2);
console.log(`- Payload zipped successfully (${zipSizeMB} MB)`);

// 3. Compile Standalone C# Executable with Embedded Payload
console.log("[3/4] Compiling standalone Windows executable (.exe)...");
const cscArgs = [
    "/target:exe",
    "/optimize+",
    "/platform:anycpu",
    "/r:System.IO.Compression.dll",
    "/r:System.IO.Compression.FileSystem.dll",
    `/resource:${ZIP_PATH},Payload.zip`,
    `/out:${EXE_PATH}`,
    CS_PATH
];

const cscRun = cp.spawnSync(CSC_COMPILER, cscArgs, { encoding: "utf8" });
if (cscRun.status !== 0 || !fs.existsSync(EXE_PATH)) {
    console.error("CSC Compilation failed:", cscRun.stderr || cscRun.stdout);
    process.exit(1);
}

// 4. Create convenient launchers in network_app
console.log("[4/4] Creating companion launchers...");

// Start_Proxy_Console.cmd
fs.writeFileSync(path.join(OUTPUT_DIR, "Start_Proxy_Console.cmd"), `@echo off
cd /d "%~dp0"
title Network Web Filter Proxy
echo Starting Network Web Filter Proxy...
NetworkWebFilterProxy.exe
`.trim());

// Start_Proxy_Background.vbs
fs.writeFileSync(path.join(OUTPUT_DIR, "Start_Proxy_Background.vbs"), `Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
WshShell.Run "NetworkWebFilterProxy.exe", 0, False
`.trim());

// Install_Certificate.cmd
fs.writeFileSync(path.join(OUTPUT_DIR, "Install_Certificate.cmd"), `@echo off
cd /d "%~dp0"
echo ========================================================
echo   Installing Root CA Certificate into Windows Store...
echo ========================================================
certutil -user -addstore -f "ROOT" "%LOCALAPPDATA%\\NetworkWebFilterProxy\\certs\\ca.crt" 2>nul
if %errorlevel% neq 0 (
    certutil -user -addstore -f "ROOT" "%~dp0..\\certs\\ca.crt" 2>nul
)
echo Certificate installed successfully!
pause
`.trim());

// Clean up temporary files
try {
    fs.unlinkSync(ZIP_PATH);
    fs.rmSync(STAGING_DIR, { recursive: true, force: true });
} catch (_) {}

const exeSizeMB = (fs.statSync(EXE_PATH).size / 1024 / 1024).toFixed(2);
console.log("==================================================");
console.log("           EXE Build Successful!                  ");
console.log("==================================================");
console.log(`Executable  : ${EXE_PATH}`);
console.log(`File Size   : ${exeSizeMB} MB`);
console.log("Ready to run instantly on any Windows PC without install!");
console.log("==================================================");
