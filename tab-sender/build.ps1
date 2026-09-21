# build.ps1 - Build the tab-bridge.exe binary (hidden window, stripped, no console).
# Usage:  powershell -ExecutionPolicy Bypass -File build.ps1
[CmdletBinding()]
param(
    [string]$OutputPath = "$PSScriptRoot\tab-bridge.exe"
)

$ErrorActionPreference = "Stop"
$BridgeDir = Join-Path $PSScriptRoot "bridge"

Write-Host "Building tab-bridge in $BridgeDir ..."
Push-Location $BridgeDir
try {
    & go mod download
    if ($LASTEXITCODE -ne 0) { throw "go mod download failed" }

    # -H windowsgui: no console window (GUI subsystem, hides the black box)
    # -s -w: strip symbol table and DWARF for smaller binary
    & go build -ldflags "-H windowsgui -s -w" -o $OutputPath .
    if ($LASTEXITCODE -ne 0) { throw "go build failed" }

    $info = Get-Item $OutputPath
    Write-Host "BUILD OK" -ForegroundColor Green
    Write-Host ("  " + $info.FullName)
    Write-Host ("  " + [math]::Round($info.Length / 1MB, 2) + " MB")
}
finally {
    Pop-Location
}
