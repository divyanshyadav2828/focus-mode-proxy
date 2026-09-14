"use strict";

const fs = require("fs");
const path = require("path");
const cp = require("child_process");

console.log("==================================================");
console.log("      Building Network Web Filter Proxy MSI       ");
console.log("==================================================");

const ROOT_DIR = path.resolve(__dirname, "..");
const STAGING_DIR = path.join(ROOT_DIR, "build_staging");
const OUTPUT_DIR = path.join(ROOT_DIR, "network_app");
const MSI_PATH = path.join(OUTPUT_DIR, "NetworkWebFilterProxy.msi");
const DDF_PATH = path.join(ROOT_DIR, "makecab.ddf");
const CAB_DIR = path.join(ROOT_DIR, "cab_temp");
const CAB_FILE = path.join(CAB_DIR, "Data1.cab");
const FILE_LIST_PATH = path.join(ROOT_DIR, "file_list.json");
const PS_SCRIPT_PATH = path.join(ROOT_DIR, "generate_msi.ps1");

// 1. Clean and prepare staging directory
console.log("[1/5] Preparing staging directory...");
if (fs.existsSync(STAGING_DIR)) fs.rmSync(STAGING_DIR, { recursive: true, force: true });
if (fs.existsSync(CAB_DIR)) fs.rmSync(CAB_DIR, { recursive: true, force: true });
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

fs.mkdirSync(STAGING_DIR, { recursive: true });
fs.mkdirSync(CAB_DIR, { recursive: true });

// Copy node.exe from current process so the app is 100% self-contained
const nodeExecPath = process.execPath;
console.log(`- Copying standalone Node runtime from ${nodeExecPath}...`);
fs.copyFileSync(nodeExecPath, path.join(STAGING_DIR, "node.exe"));

// Copy app files
fs.copyFileSync(path.join(ROOT_DIR, "src", "proxy.js"), path.join(STAGING_DIR, "proxy.js"));
fs.copyFileSync(path.join(ROOT_DIR, "config.js"), path.join(STAGING_DIR, "config.js"));
fs.copyFileSync(path.join(ROOT_DIR, "package.json"), path.join(STAGING_DIR, "package.json"));

// Copy certs
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

console.log("- Copying certs directory...");
copyDirRecursive(path.join(ROOT_DIR, "certs"), path.join(STAGING_DIR, "certs"));

console.log("- Copying node_modules...");
copyDirRecursive(path.join(ROOT_DIR, "node_modules"), path.join(STAGING_DIR, "node_modules"));

// Create helper scripts
console.log("- Creating helper scripts & launchers...");

// start-proxy.vbs (silent background runner)
fs.writeFileSync(path.join(STAGING_DIR, "start-proxy.vbs"), `
Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
WshShell.Run "node.exe proxy.js", 0, False
`.trim());

// run-proxy.cmd (interactive console runner)
fs.writeFileSync(path.join(STAGING_DIR, "run-proxy.cmd"), `
@echo off
cd /d "%~dp0"
title Network Web Filter Proxy
echo ========================================================
echo        Starting Network Web Filter Proxy
echo ========================================================
node.exe proxy.js
pause
`.trim());

// install-cert.cmd (auto-installs CA into Windows Trusted Root Store)
fs.writeFileSync(path.join(STAGING_DIR, "install-cert.cmd"), `
@echo off
cd /d "%~dp0"
echo ========================================================
echo   Installing Root CA Certificate into Windows Store...
echo ========================================================
certutil -user -addstore -f "ROOT" "certs\\ca.crt"
echo.
echo Certificate installation complete!
pause
`.trim());

// stop-proxy.cmd
fs.writeFileSync(path.join(STAGING_DIR, "stop-proxy.cmd"), `
@echo off
echo Stopping Network Web Filter Proxy...
taskkill /f /im node.exe 2>nul
echo Proxy stopped.
pause
`.trim());

// 2. Scan all files in staging directory
console.log("[2/5] Indexing all application files for cabinet packing...");
function getAllFiles(dir, baseDir = dir) {
    let results = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relPath = path.relative(baseDir, fullPath);
        if (entry.isDirectory()) {
            results = results.concat(getAllFiles(fullPath, baseDir));
        } else {
            const stat = fs.statSync(fullPath);
            results.push({
                fullPath,
                relPath,
                name: entry.name,
                size: stat.size
            });
        }
    }
    return results;
}

const allFiles = getAllFiles(STAGING_DIR);
console.log(`- Total files to package: ${allFiles.length}`);

// 3. Build cabinet Data1.cab using makecab
console.log("[3/5] Compressing files into Data1.cab with makecab...");
const ddfLines = [
    ".Set CabinetNameTemplate=Data1.cab",
    `.Set DiskDirectory1=${CAB_DIR}`,
    ".Set MaxDiskSize=CDROM",
    ".Set Cabinet=ON",
    ".Set Compress=ON",
    ".Set CompressionType=MSZIP",
    ".Set UniqueFiles=OFF",
    ".Set FolderFileCountThreshold=0"
];

for (const file of allFiles) {
    ddfLines.push(`"${file.fullPath}" "${file.relPath}"`);
}

fs.writeFileSync(DDF_PATH, ddfLines.join("\r\n"), "utf8");
const makecabRun = cp.spawnSync("makecab", ["/f", DDF_PATH], { stdio: "pipe", encoding: "utf8" });
if (makecabRun.status !== 0) {
    console.error("makecab error:", makecabRun.stderr || makecabRun.stdout);
    process.exit(1);
}
console.log(`- Data1.cab created successfully (Size: ${(fs.statSync(CAB_FILE).size / 1024 / 1024).toFixed(2)} MB)`);

// 4. Generate MSI Database using WindowsInstaller.Installer COM object via PowerShell
console.log("[4/5] Building Windows Installer (.msi) database...");

fs.writeFileSync(FILE_LIST_PATH, JSON.stringify(allFiles, null, 2), "utf8");

const psScript = `
$ErrorActionPreference = "Stop"

$installer = New-Object -ComObject WindowsInstaller.Installer
$msiPath = "${MSI_PATH.replace(/\\/g, "\\\\")}"
$cabPath = "${CAB_FILE.replace(/\\/g, "\\\\")}"
$fileListJson = "${FILE_LIST_PATH.replace(/\\/g, "\\\\")}"

if (Test-Path $msiPath) {
    Remove-Item $msiPath -Force
}

# Create new MSI database in create mode (3 = msiOpenDatabaseModeCreate)
$db = $installer.OpenDatabase($msiPath, 3)

function Exec-Sql($sql) {
    $v = $db.OpenView($sql)
    $v.Execute()
    $v.Close()
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($v) | Out-Null
}

# 1. Directory Table
Exec-Sql "CREATE TABLE \`Directory\` (\`Directory\` CHAR(72) NOT NULL, \`Directory_Parent\` CHAR(72), \`DefaultDir\` CHAR(255) NOT NULL PRIMARY KEY \`Directory\`)"
Exec-Sql "INSERT INTO \`Directory\` (\`Directory\`, \`Directory_Parent\`,\`DefaultDir\`) VALUES ('TARGETDIR', NULL, 'SourceDir')"
Exec-Sql "INSERT INTO \`Directory\` (\`Directory\`, \`Directory_Parent\`,\`DefaultDir\`) VALUES ('ProgramFilesFolder', 'TARGETDIR', 'PFiles')"
Exec-Sql "INSERT INTO \`Directory\` (\`Directory\`, \`Directory_Parent\`,\`DefaultDir\`) VALUES ('INSTALLDIR', 'ProgramFilesFolder', 'NetworkWebFilterProxy')"
Exec-Sql "INSERT INTO \`Directory\` (\`Directory\`, \`Directory_Parent\`,\`DefaultDir\`) VALUES ('ProgramMenuFolder', 'TARGETDIR', 'Programs')"
Exec-Sql "INSERT INTO \`Directory\` (\`Directory\`, \`Directory_Parent\`,\`DefaultDir\`) VALUES ('DesktopFolder', 'TARGETDIR', 'Desktop')"

# Dynamically add all subdirectories
$dirMap = @{}
$dirMap[''] = 'INSTALLDIR'
$dirCounter = 1

$allFilesJson = Get-Content $fileListJson | ConvertFrom-Json

$dirView = $db.OpenView("INSERT INTO \`Directory\` (\`Directory\`, \`Directory_Parent\`, \`DefaultDir\`) VALUES (?, ?, ?)")

foreach ($item in $allFilesJson) {
    $dirName = [System.IO.Path]::GetDirectoryName($item.relPath)
    if ($dirName -and -not $dirMap.ContainsKey($dirName)) {
        $parts = $dirName.Split([System.IO.Path]::DirectorySeparatorChar)
        $currPath = ""
        for ($i = 0; $i -lt $parts.Length; $i++) {
            $parentPath = $currPath
            if ($currPath -eq "") { $parentDirId = "INSTALLDIR" } else { $parentDirId = $dirMap[$currPath] }
            if ($currPath -eq "") { $currPath = $parts[$i] } else { $currPath = "$currPath\\" + $parts[$i] }
            
            if (-not $dirMap.ContainsKey($currPath)) {
                $dirId = "DIR_$dirCounter"
                $dirCounter++
                $dirMap[$currPath] = $dirId
                $safeDefault = $parts[$i]
                
                $r = $installer.CreateRecord(3)
                $r.StringData(1) = $dirId
                $r.StringData(2) = $parentDirId
                $r.StringData(3) = $safeDefault
                $dirView.Execute($r)
                [System.Runtime.InteropServices.Marshal]::ReleaseComObject($r) | Out-Null
            }
        }
    }
}
$dirView.Close()
[System.Runtime.InteropServices.Marshal]::ReleaseComObject($dirView) | Out-Null

# 2. Component Table
Exec-Sql "CREATE TABLE \`Component\` (\`Component\` CHAR(72) NOT NULL, \`ComponentId\` CHAR(38), \`Directory_\` CHAR(72) NOT NULL, \`Attributes\` SHORT NOT NULL, \`Condition\` CHAR(255), \`KeyPath\` CHAR(72) PRIMARY KEY \`Component\`)"

# 3. File Table
Exec-Sql "CREATE TABLE \`File\` (\`File\` CHAR(72) NOT NULL, \`Component_\` CHAR(72) NOT NULL, \`FileName\` CHAR(255) NOT NULL, \`FileSize\` LONG NOT NULL, \`Version\` CHAR(72), \`Language\` CHAR(20), \`Attributes\` SHORT, \`Sequence\` SHORT NOT NULL PRIMARY KEY \`File\`)"

# 4. Feature Table
Exec-Sql "CREATE TABLE \`Feature\` (\`Feature\` CHAR(38) NOT NULL, \`Feature_Parent\` CHAR(38), \`Title\` CHAR(64), \`Description\` CHAR(255), \`Display\` SHORT NOT NULL, \`Level\` SHORT NOT NULL, \`Directory_\` CHAR(72), \`Attributes\` SHORT NOT NULL PRIMARY KEY \`Feature\`)"
Exec-Sql "INSERT INTO \`Feature\` (\`Feature\`, \`Feature_Parent\`, \`Title\`, \`Description\`, \`Display\`, \`Level\`, \`Directory_\`, \`Attributes\`) VALUES ('Complete', NULL, 'Network Web Filter Proxy', 'Complete installation of Network Web Filter Proxy', 2, 1, 'INSTALLDIR', 0)"

# 5. FeatureComponents Table
Exec-Sql "CREATE TABLE \`FeatureComponents\` (\`Feature_\` CHAR(38) NOT NULL, \`Component_\` CHAR(72) NOT NULL PRIMARY KEY \`Feature_\`, \`Component_\`)"

# 6. Populate Files and Components using parameterized views
$compView = $db.OpenView("INSERT INTO \`Component\` (\`Component\`, \`ComponentId\`, \`Directory_\`, \`Attributes\`, \`Condition\`, \`KeyPath\`) VALUES (?, ?, ?, ?, ?, ?)")
$fileView = $db.OpenView("INSERT INTO \`File\` (\`File\`, \`Component_\`, \`FileName\`, \`FileSize\`, \`Version\`, \`Language\`, \`Attributes\`, \`Sequence\`) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
$fcView = $db.OpenView("INSERT INTO \`FeatureComponents\` (\`Feature_\`, \`Component_\`) VALUES (?, ?)")

$rC = $installer.CreateRecord(6)
$rF = $installer.CreateRecord(8)
$rFC = $installer.CreateRecord(2)

$fileSeq = 1
foreach ($item in $allFilesJson) {
    $dirName = [System.IO.Path]::GetDirectoryName($item.relPath)
    if ($dirName -and $dirMap.ContainsKey($dirName)) {
        $compDir = $dirMap[$dirName]
    } else {
        $compDir = "INSTALLDIR"
    }

    $compId = "CMP_$fileSeq"
    $fileId = "FILE_$fileSeq"
    $guid = [guid]::NewGuid().ToString("B").ToUpper()
    $fileName = $item.name
    $fileSize = [int]$item.size

    # Component record
    $rC.StringData(1) = $compId
    $rC.StringData(2) = $guid
    $rC.StringData(3) = $compDir
    $rC.IntegerData(4) = 0
    $rC.StringData(5) = ""
    $rC.StringData(6) = $fileId
    $compView.Execute($rC)

    # File record
    $rF.StringData(1) = $fileId
    $rF.StringData(2) = $compId
    $rF.StringData(3) = $fileName
    $rF.IntegerData(4) = $fileSize
    $rF.StringData(5) = ""
    $rF.StringData(6) = ""
    $rF.IntegerData(7) = 512
    $rF.IntegerData(8) = [int]$fileSeq
    $fileView.Execute($rF)

    # FeatureComponents record
    $rFC.StringData(1) = "Complete"
    $rFC.StringData(2) = $compId
    $fcView.Execute($rFC)

    $fileSeq++
}

[System.Runtime.InteropServices.Marshal]::ReleaseComObject($rC) | Out-Null
[System.Runtime.InteropServices.Marshal]::ReleaseComObject($rF) | Out-Null
[System.Runtime.InteropServices.Marshal]::ReleaseComObject($rFC) | Out-Null

$compView.Close()
$fileView.Close()
$fcView.Close()
[System.Runtime.InteropServices.Marshal]::ReleaseComObject($compView) | Out-Null
[System.Runtime.InteropServices.Marshal]::ReleaseComObject($fileView) | Out-Null
[System.Runtime.InteropServices.Marshal]::ReleaseComObject($fcView) | Out-Null

# 7. Media Table (pointing to #Data1.cab embedded stream)
Exec-Sql "CREATE TABLE \`Media\` (\`DiskId\` SHORT NOT NULL, \`LastSequence\` SHORT NOT NULL, \`DiskPrompt\` CHAR(64), \`Cabinet\` CHAR(255), \`VolumeLabel\` CHAR(32), \`Source\` CHAR(72) PRIMARY KEY \`DiskId\`)"
$lastSeq = $allFilesJson.Count
Exec-Sql "INSERT INTO \`Media\` (\`DiskId\`, \`LastSequence\`, \`DiskPrompt\`, \`Cabinet\`, \`VolumeLabel\`, \`Source\`) VALUES (1, $lastSeq, '1', '#Data1.cab', NULL, NULL)"

# 8. Property Table
Exec-Sql "CREATE TABLE \`Property\` (\`Property\` CHAR(72) NOT NULL, \`Value\` CHAR(255) NOT NULL PRIMARY KEY \`Property\`)"
Exec-Sql "INSERT INTO \`Property\` (\`Property\`, \`Value\`) VALUES ('ProductLanguage', '1033')"
Exec-Sql "INSERT INTO \`Property\` (\`Property\`, \`Value\`) VALUES ('ProductName', 'Network Web Filter Proxy')"
Exec-Sql "INSERT INTO \`Property\` (\`Property\`, \`Value\`) VALUES ('ProductVersion', '1.0.0')"
Exec-Sql "INSERT INTO \`Property\` (\`Property\`, \`Value\`) VALUES ('Manufacturer', 'Divyansh Yadav')"
Exec-Sql "INSERT INTO \`Property\` (\`Property\`, \`Value\`) VALUES ('ProductCode', '{B4E5F6A7-1234-5678-9ABC-DEF012345678}')"
Exec-Sql "INSERT INTO \`Property\` (\`Property\`, \`Value\`) VALUES ('UpgradeCode', '{C5F6A7B8-2345-6789-01BC-DEF012345679}')"
Exec-Sql "INSERT INTO \`Property\` (\`Property\`, \`Value\`) VALUES ('ALLUSERS', '1')"
Exec-Sql "INSERT INTO \`Property\` (\`Property\`, \`Value\`) VALUES ('ARPCONTACT', 'Divyansh Yadav')"
Exec-Sql "INSERT INTO \`Property\` (\`Property\`, \`Value\`) VALUES ('ARPNOMODIFY', '1')"

# 9. Shortcut Table
Exec-Sql "CREATE TABLE \`Shortcut\` (\`Shortcut\` CHAR(72) NOT NULL, \`Directory_\` CHAR(72) NOT NULL, \`Name\` CHAR(128) NOT NULL, \`Component_\` CHAR(72) NOT NULL, \`Target\` CHAR(72) NOT NULL, \`Arguments\` CHAR(255), \`Description\` CHAR(255), \`Hotkey\` SHORT, \`Icon_\` CHAR(72), \`IconIndex\` SHORT, \`ShowCmd\` SHORT, \`WkDir\` CHAR(72) PRIMARY KEY \`Shortcut\`)"
# Start Menu shortcut to run-proxy.cmd and start-proxy.vbs
Exec-Sql "INSERT INTO \`Shortcut\` (\`Shortcut\`, \`Directory_\`, \`Name\`, \`Component_\`, \`Target\`, \`Arguments\`, \`Description\`, \`Hotkey\`, \`Icon_\`, \`IconIndex\`, \`ShowCmd\`, \`WkDir\`) VALUES ('SC_StartProxy', 'ProgramMenuFolder', 'Start Network Web Filter Proxy', 'CMP_1', '[INSTALLDIR]start-proxy.vbs', NULL, 'Start Network Web Filter Proxy in background', NULL, NULL, NULL, 1, 'INSTALLDIR')"
Exec-Sql "INSERT INTO \`Shortcut\` (\`Shortcut\`, \`Directory_\`, \`Name\`, \`Component_\`, \`Target\`, \`Arguments\`, \`Description\`, \`Hotkey\`, \`Icon_\`, \`IconIndex\`, \`ShowCmd\`, \`WkDir\`) VALUES ('SC_RunConsole', 'ProgramMenuFolder', 'Run Network Proxy (Console)', 'CMP_1', '[INSTALLDIR]run-proxy.cmd', NULL, 'Run Network Web Filter Proxy in console', NULL, NULL, NULL, 1, 'INSTALLDIR')"
Exec-Sql "INSERT INTO \`Shortcut\` (\`Shortcut\`, \`Directory_\`, \`Name\`, \`Component_\`, \`Target\`, \`Arguments\`, \`Description\`, \`Hotkey\`, \`Icon_\`, \`IconIndex\`, \`ShowCmd\`, \`WkDir\`) VALUES ('SC_InstallCert', 'ProgramMenuFolder', 'Install Proxy Root Certificate', 'CMP_1', '[INSTALLDIR]install-cert.cmd', NULL, 'Install Proxy CA Certificate into Windows Trust Store', NULL, NULL, NULL, 1, 'INSTALLDIR')"

# Desktop shortcut
Exec-Sql "INSERT INTO \`Shortcut\` (\`Shortcut\`, \`Directory_\`, \`Name\`, \`Component_\`, \`Target\`, \`Arguments\`, \`Description\`, \`Hotkey\`, \`Icon_\`, \`IconIndex\`, \`ShowCmd\`, \`WkDir\`) VALUES ('SC_DesktopProxy', 'DesktopFolder', 'Network Web Filter Proxy', 'CMP_1', '[INSTALLDIR]start-proxy.vbs', NULL, 'Start Network Web Filter Proxy', NULL, NULL, NULL, 1, 'INSTALLDIR')"

# 10. InstallExecuteSequence Table
Exec-Sql "CREATE TABLE \`InstallExecuteSequence\` (\`Action\` CHAR(72) NOT NULL, \`Condition\` CHAR(255), \`Sequence\` SHORT PRIMARY KEY \`Action\`)"
Exec-Sql "INSERT INTO \`InstallExecuteSequence\` (\`Action\`, \`Condition\`, \`Sequence\`) VALUES ('CostInitialize', NULL, 800)"
Exec-Sql "INSERT INTO \`InstallExecuteSequence\` (\`Action\`, \`Condition\`, \`Sequence\`) VALUES ('FileCost', NULL, 900)"
Exec-Sql "INSERT INTO \`InstallExecuteSequence\` (\`Action\`, \`Condition\`, \`Sequence\`) VALUES ('CostFinalize', NULL, 1000)"
Exec-Sql "INSERT INTO \`InstallExecuteSequence\` (\`Action\`, \`Condition\`, \`Sequence\`) VALUES ('InstallValidate', NULL, 1400)"
Exec-Sql "INSERT INTO \`InstallExecuteSequence\` (\`Action\`, \`Condition\`, \`Sequence\`) VALUES ('InstallInitialize', NULL, 1500)"
Exec-Sql "INSERT INTO \`InstallExecuteSequence\` (\`Action\`, \`Condition\`, \`Sequence\`) VALUES ('ProcessComponents', NULL, 1600)"
Exec-Sql "INSERT INTO \`InstallExecuteSequence\` (\`Action\`, \`Condition\`, \`Sequence\`) VALUES ('UnpublishFeatures', NULL, 1800)"
Exec-Sql "INSERT INTO \`InstallExecuteSequence\` (\`Action\`, \`Condition\`, \`Sequence\`) VALUES ('RemoveShortcuts', NULL, 3200)"
Exec-Sql "INSERT INTO \`InstallExecuteSequence\` (\`Action\`, \`Condition\`, \`Sequence\`) VALUES ('RemoveFiles', NULL, 3500)"
Exec-Sql "INSERT INTO \`InstallExecuteSequence\` (\`Action\`, \`Condition\`, \`Sequence\`) VALUES ('InstallFiles', NULL, 4000)"
Exec-Sql "INSERT INTO \`InstallExecuteSequence\` (\`Action\`, \`Condition\`, \`Sequence\`) VALUES ('CreateShortcuts', NULL, 4500)"
Exec-Sql "INSERT INTO \`InstallExecuteSequence\` (\`Action\`, \`Condition\`, \`Sequence\`) VALUES ('RegisterUser', NULL, 6000)"
Exec-Sql "INSERT INTO \`InstallExecuteSequence\` (\`Action\`, \`Condition\`, \`Sequence\`) VALUES ('RegisterProduct', NULL, 6100)"
Exec-Sql "INSERT INTO \`InstallExecuteSequence\` (\`Action\`, \`Condition\`, \`Sequence\`) VALUES ('PublishFeatures', NULL, 6300)"
Exec-Sql "INSERT INTO \`InstallExecuteSequence\` (\`Action\`, \`Condition\`, \`Sequence\`) VALUES ('PublishProduct', NULL, 6400)"
Exec-Sql "INSERT INTO \`InstallExecuteSequence\` (\`Action\`, \`Condition\`, \`Sequence\`) VALUES ('InstallFinalize', NULL, 6600)"

# 11. InstallUISequence Table
Exec-Sql "CREATE TABLE \`InstallUISequence\` (\`Action\` CHAR(72) NOT NULL, \`Condition\` CHAR(255), \`Sequence\` SHORT PRIMARY KEY \`Action\`)"
Exec-Sql "INSERT INTO \`InstallUISequence\` (\`Action\`, \`Condition\`, \`Sequence\`) VALUES ('CostInitialize', NULL, 800)"
Exec-Sql "INSERT INTO \`InstallUISequence\` (\`Action\`, \`Condition\`, \`Sequence\`) VALUES ('FileCost', NULL, 900)"
Exec-Sql "INSERT INTO \`InstallUISequence\` (\`Action\`, \`Condition\`, \`Sequence\`) VALUES ('CostFinalize', NULL, 1000)"
Exec-Sql "INSERT INTO \`InstallUISequence\` (\`Action\`, \`Condition\`, \`Sequence\`) VALUES ('ExecuteAction', NULL, 1300)"

# 12. AdminExecuteSequence Table
Exec-Sql "CREATE TABLE \`AdminExecuteSequence\` (\`Action\` CHAR(72) NOT NULL, \`Condition\` CHAR(255), \`Sequence\` SHORT PRIMARY KEY \`Action\`)"
Exec-Sql "INSERT INTO \`AdminExecuteSequence\` (\`Action\`, \`Condition\`, \`Sequence\`) VALUES ('CostInitialize', NULL, 800)"
Exec-Sql "INSERT INTO \`AdminExecuteSequence\` (\`Action\`, \`Condition\`, \`Sequence\`) VALUES ('FileCost', NULL, 900)"
Exec-Sql "INSERT INTO \`AdminExecuteSequence\` (\`Action\`, \`Condition\`, \`Sequence\`) VALUES ('CostFinalize', NULL, 1000)"
Exec-Sql "INSERT INTO \`AdminExecuteSequence\` (\`Action\`, \`Condition\`, \`Sequence\`) VALUES ('InstallValidate', NULL, 1400)"
Exec-Sql "INSERT INTO \`AdminExecuteSequence\` (\`Action\`, \`Condition\`, \`Sequence\`) VALUES ('InstallInitialize', NULL, 1500)"
Exec-Sql "INSERT INTO \`AdminExecuteSequence\` (\`Action\`, \`Condition\`, \`Sequence\`) VALUES ('InstallAdminPackage', NULL, 3900)"
Exec-Sql "INSERT INTO \`AdminExecuteSequence\` (\`Action\`, \`Condition\`, \`Sequence\`) VALUES ('InstallFiles', NULL, 4000)"
Exec-Sql "INSERT INTO \`AdminExecuteSequence\` (\`Action\`, \`Condition\`, \`Sequence\`) VALUES ('InstallFinalize', NULL, 6600)"

# 13. Embed Data1.cab into _Streams table
Write-Host "Embedding Data1.cab into MSI database stream..."
$view = $db.OpenView("INSERT INTO \`_Streams\` (\`Name\`, \`Data\`) VALUES ('Data1.cab', ?)")
$record = $installer.CreateRecord(1)
$record.SetStream(1, $cabPath)
$view.Execute($record)
$view.Close()
[System.Runtime.InteropServices.Marshal]::ReleaseComObject($record) | Out-Null
[System.Runtime.InteropServices.Marshal]::ReleaseComObject($view) | Out-Null

# 14. Summary Information Stream
$sumInfo = $db.SummaryInformation(20)
$sumInfo.Property(2) = "Network Web Filter Proxy" # Title
$sumInfo.Property(3) = "Installation Database for Network Web Filter Proxy" # Subject
$sumInfo.Property(4) = "Divyansh Yadav" # Author
$sumInfo.Property(7) = "Intel;1033" # Template
$sumInfo.Property(9) = "{C5F6A7B8-2345-6789-01BC-DEF012345679}" # Package Code
$sumInfo.Property(14) = 200 # PageCount / Min MSI version 2.0
$sumInfo.Property(15) = 2 # WordCount / Source flags (Compressed)
$sumInfo.Persist()

# 15. Commit and Close Database
$db.Commit()

# Release COM objects
[System.Runtime.InteropServices.Marshal]::ReleaseComObject($sumInfo) | Out-Null
[System.Runtime.InteropServices.Marshal]::ReleaseComObject($db) | Out-Null
[System.Runtime.InteropServices.Marshal]::ReleaseComObject($installer) | Out-Null
[System.GC]::Collect()

Write-Host "MSI generated successfully!"
`;

fs.writeFileSync(PS_SCRIPT_PATH, psScript, "utf8");

// Run PowerShell script
const psRun = cp.spawnSync("powershell", ["-ExecutionPolicy", "Bypass", "-File", PS_SCRIPT_PATH], {
    stdio: "pipe",
    encoding: "utf8"
});

if (psRun.status !== 0) {
    console.error("PowerShell MSI build error:", psRun.stderr || psRun.stdout);
    process.exit(1);
}

console.log(psRun.stdout.trim());

// Clean temp files
try {
    fs.unlinkSync(DDF_PATH);
    fs.unlinkSync(PS_SCRIPT_PATH);
    fs.unlinkSync(FILE_LIST_PATH);
    fs.rmSync(CAB_DIR, { recursive: true, force: true });
    fs.rmSync(STAGING_DIR, { recursive: true, force: true });
} catch (_) {}

console.log("[5/5] Build Complete!");
console.log("==================================================");
console.log(`Generated MSI Installer: ${MSI_PATH}`);
console.log(`File Size: ${(fs.statSync(MSI_PATH).size / 1024 / 1024).toFixed(2)} MB`);
console.log("==================================================");
