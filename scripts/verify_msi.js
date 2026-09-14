"use strict";

const cp = require("child_process");
const path = require("path");
const fs = require("fs");

const msiPath = path.resolve(__dirname, "..", "network_app", "NetworkWebFilterProxy.msi");

console.log("==================================================");
console.log("           MSI Package Verification               ");
console.log("==================================================");
console.log(`File Path : ${msiPath}`);
console.log(`File Size : ${(fs.statSync(msiPath).size / 1024 / 1024).toFixed(2)} MB`);

const psLines = [
    "$ErrorActionPreference = 'Stop'",
    "$installer = New-Object -ComObject WindowsInstaller.Installer",
    `$db = $installer.OpenDatabase('${msiPath.replace(/\\/g, "\\\\")}', 0)`,
    "",
    "Write-Host ''",
    "Write-Host '--- Table Record Counts ---'",
    "$tables = @('Directory', 'Component', 'File', 'Feature', 'FeatureComponents', 'Media', 'Shortcut', 'InstallExecuteSequence', 'InstallUISequence', 'AdminExecuteSequence')",
    "foreach ($t in $tables) {",
    "    $sql = 'SELECT * FROM ' + [char]96 + $t + [char]96",
    "    $v = $db.OpenView($sql)",
    "    $v.Execute()",
    "    $cnt = 0",
    "    while ($r = $v.Fetch()) {",
    "        $cnt++",
    "        [System.Runtime.InteropServices.Marshal]::ReleaseComObject($r) | Out-Null",
    "    }",
    "    $v.Close()",
    "    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($v) | Out-Null",
    "    Write-Host ('- ' + $t.PadRight(25) + ': ' + $cnt + ' records')",
    "}",
    "",
    "Write-Host ''",
    "Write-Host '--- Embedded Streams ---'",
    "$strView = $db.OpenView('SELECT ' + [char]96 + 'Name' + [char]96 + ' FROM ' + [char]96 + '_Streams' + [char]96)",
    "$strView.Execute()",
    "while ($r = $strView.Fetch()) {",
    "    Write-Host ('- Stream: ' + $r.StringData(1))",
    "    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($r) | Out-Null",
    "}",
    "$strView.Close()",
    "[System.Runtime.InteropServices.Marshal]::ReleaseComObject($strView) | Out-Null",
    "",
    "Write-Host ''",
    "Write-Host '--- Property Table ---'",
    "$pView = $db.OpenView('SELECT ' + [char]96 + 'Property' + [char]96 + ', ' + [char]96 + 'Value' + [char]96 + ' FROM ' + [char]96 + 'Property' + [char]96)",
    "$pView.Execute()",
    "while ($r = $pView.Fetch()) {",
    "    Write-Host ('- ' + $r.StringData(1).PadRight(20) + ' = ' + $r.StringData(2))",
    "    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($r) | Out-Null",
    "}",
    "$pView.Close()",
    "[System.Runtime.InteropServices.Marshal]::ReleaseComObject($pView) | Out-Null",
    "",
    "Write-Host ''",
    "Write-Host '--- Shortcuts ---'",
    "$sView = $db.OpenView('SELECT ' + [char]96 + 'Shortcut' + [char]96 + ', ' + [char]96 + 'Directory_' + [char]96 + ', ' + [char]96 + 'Name' + [char]96 + ', ' + [char]96 + 'Target' + [char]96 + ' FROM ' + [char]96 + 'Shortcut' + [char]96)",
    "$sView.Execute()",
    "while ($r = $sView.Fetch()) {",
    "    Write-Host ('- ' + $r.StringData(1).PadRight(18) + ' | Dir: ' + $r.StringData(2).PadRight(18) + ' | Name: ' + $r.StringData(3).PadRight(32) + ' | Target: ' + $r.StringData(4))",
    "    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($r) | Out-Null",
    "}",
    "$sView.Close()",
    "[System.Runtime.InteropServices.Marshal]::ReleaseComObject($sView) | Out-Null",
    "",
    "Write-Host ''",
    "Write-Host '--- Summary Information ---'",
    "$sum = $db.SummaryInformation(0)",
    "Write-Host ('- Title        : ' + $sum.Property(2))",
    "Write-Host ('- Subject      : ' + $sum.Property(3))",
    "Write-Host ('- Author       : ' + $sum.Property(4))",
    "Write-Host ('- Template     : ' + $sum.Property(7))",
    "Write-Host ('- Package Code : ' + $sum.Property(9))",
    "Write-Host ('- Min Version  : ' + $sum.Property(14))",
    "Write-Host ('- WordCount    : ' + $sum.Property(15))",
    "",
    "[System.Runtime.InteropServices.Marshal]::ReleaseComObject($sum) | Out-Null",
    "[System.Runtime.InteropServices.Marshal]::ReleaseComObject($db) | Out-Null",
    "[System.Runtime.InteropServices.Marshal]::ReleaseComObject($installer) | Out-Null"
];

const psTempPath = path.join(__dirname, "temp_verify.ps1");
fs.writeFileSync(psTempPath, psLines.join("\r\n"), "utf8");

const res = cp.spawnSync("powershell", ["-ExecutionPolicy", "Bypass", "-File", psTempPath], {
    encoding: "utf8"
});

try { fs.unlinkSync(psTempPath); } catch (_) {}

console.log(res.stdout || res.stderr);

console.log("==================================================");
console.log("           MSI Verification Complete!             ");
console.log("==================================================");
