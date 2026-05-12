# snap.ps1 — take a screenshot and save it to screenshots/ with an optional label.
#
# Usage:
#   .\tools\snap.ps1                              # captures whole virtual screen
#   .\tools\snap.ps1 -Label "test-passing"        # adds a label to the filename
#   .\tools\snap.ps1 -Window                      # active window only
#
# Output: screenshots/YYYY-MM-DD_HH-MM-SS[_label].png
#
# Claude Code is allowed to run this script during development to capture
# content-worthy moments. The output goes to a folder that is gitignored.

param(
    [string]$Label = "",
    [switch]$Window
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$repoRoot = Split-Path -Parent $PSScriptRoot
$screenshotsDir = Join-Path $repoRoot "screenshots"
if (-not (Test-Path $screenshotsDir)) {
    New-Item -ItemType Directory -Path $screenshotsDir | Out-Null
}

$timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$labelPart = if ($Label) { "_$($Label -replace '[^a-zA-Z0-9-]','-')" } else { "" }
$filename = "${timestamp}${labelPart}.png"
$outPath = Join-Path $screenshotsDir $filename

if ($Window) {
    # Active window bounds via P/Invoke. Falls back to virtual screen if it fails.
    # Fully-qualified attribute names so we don't need -UsingNamespace, which
    # collides with Add-Type's implicit using-directive insertion.
    $sig = @"
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern IntPtr GetForegroundWindow();
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
[System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]
public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
}
"@
    if (-not ("SnapPS.Win32" -as [type])) {
        Add-Type -MemberDefinition $sig -Name Win32 -Namespace SnapPS
    }
    $hwnd = [SnapPS.Win32]::GetForegroundWindow()
    $rect = New-Object SnapPS.Win32+RECT
    [void][SnapPS.Win32]::GetWindowRect($hwnd, [ref]$rect)
    $width = $rect.Right - $rect.Left
    $height = $rect.Bottom - $rect.Top
    if ($width -le 0 -or $height -le 0) {
        Write-Warning "Active window bounds invalid, falling back to virtual screen."
        $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
        $left = $bounds.Left; $top = $bounds.Top; $width = $bounds.Width; $height = $bounds.Height
    } else {
        $left = $rect.Left; $top = $rect.Top
    }
} else {
    $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
    $left = $bounds.Left
    $top = $bounds.Top
    $width = $bounds.Width
    $height = $bounds.Height
}

$bmp = New-Object System.Drawing.Bitmap $width, $height
$graphics = [System.Drawing.Graphics]::FromImage($bmp)
$graphics.CopyFromScreen($left, $top, 0, 0, $bmp.Size)
$bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bmp.Dispose()

$sizeKB = [math]::Round((Get-Item $outPath).Length / 1KB, 1)
Write-Output "Saved $outPath ($sizeKB KB)"
