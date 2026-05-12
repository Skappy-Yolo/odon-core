# text-to-image.ps1 — render plain text as a PNG, no terminal capture needed.
#
# Use for content shots of code, command output, ASCII diagrams, anything text.
# Cleaner than a snap.ps1 terminal capture: no UI chrome, no transparency, exact
# colours, no taskbar, no other windows in the frame.
#
# Usage:
#   .\tools\text-to-image.ps1 -InputPath docs/architecture.md -OutputPath foo.png -StartLine 17 -EndLine 50
#   .\tools\text-to-image.ps1 -Text "hello world" -OutputPath foo.png
#   git log --format="%h %s" -5 | .\tools\text-to-image.ps1 -OutputPath foo.png  (via -Text from pipeline)

[CmdletBinding(DefaultParameterSetName="File")]
param(
    [Parameter(ParameterSetName="File")][string]$InputPath = "",
    [Parameter(ParameterSetName="String", ValueFromPipeline=$true)][string[]]$Text,
    [Parameter(Mandatory=$true)][string]$OutputPath,
    [int]$StartLine = 1,
    [int]$EndLine = 0,
    [string]$Font = "",
    [single]$FontSize = 14,
    [string]$BackgroundColor = "#0d1117",
    [string]$ForegroundColor = "#e6edf3",
    [int]$Padding = 28,
    [int]$MaxWidth = 0
)

begin {
    $ErrorActionPreference = "Stop"
    $pipelineLines = @()
}

process {
    if ($PSCmdlet.ParameterSetName -eq "String" -and $Text) {
        $pipelineLines += $Text
    }
}

end {
    # Resolve text
    if ($PSCmdlet.ParameterSetName -eq "File" -and $InputPath) {
        $lines = Get-Content -Path $InputPath
        $start = [Math]::Max(0, $StartLine - 1)
        $end   = if ($EndLine -le 0) { $lines.Length - 1 } else { [Math]::Min($lines.Length - 1, $EndLine - 1) }
        $body  = $lines[$start..$end] -join "`r`n"
    } elseif ($pipelineLines.Count -gt 0) {
        $body = $pipelineLines -join "`r`n"
    } else {
        Write-Error "Provide either -InputPath or pipe text into -Text."
        return
    }

    if ($body.Length -eq 0) {
        Write-Error "Nothing to render."
        return
    }

    Add-Type -AssemblyName System.Drawing
    Add-Type -AssemblyName System.Drawing.Common -ErrorAction SilentlyContinue | Out-Null

    # Pick the first available monospace font.
    $candidates = @("Cascadia Mono", "Cascadia Code", "JetBrains Mono", "Fira Code", "Consolas", "Courier New")
    if ($Font) { $candidates = @($Font) + $candidates }
    $chosenFont = $null
    foreach ($name in $candidates) {
        try {
            $ff = New-Object System.Drawing.FontFamily($name)
            $chosenFont = $name
            $ff.Dispose()
            break
        } catch {}
    }
    if (-not $chosenFont) { $chosenFont = "Courier New" }

    $colorBG = [System.Drawing.ColorTranslator]::FromHtml($BackgroundColor)
    $colorFG = [System.Drawing.ColorTranslator]::FromHtml($ForegroundColor)

    # Render at 2x for a sharp result, downsample on save by setting DPI. Actually
    # simpler: render at the natural pixel size with anti-aliased grid fit and
    # save as PNG. Looks crisp enough on X / dev.to.

    $fontObj = New-Object System.Drawing.Font($chosenFont, $FontSize, [System.Drawing.GraphicsUnit]::Pixel)

    # Measure with a temporary graphics surface.
    $tempBmp = New-Object System.Drawing.Bitmap 4, 4
    $tempGfx = [System.Drawing.Graphics]::FromImage($tempBmp)
    $tempGfx.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $format = New-Object System.Drawing.StringFormat
    $format.FormatFlags = [System.Drawing.StringFormatFlags]::MeasureTrailingSpaces
    $maxLayoutWidth = if ($MaxWidth -gt 0) { $MaxWidth } else { 8000 }
    $size = $tempGfx.MeasureString($body, $fontObj, $maxLayoutWidth, $format)
    $tempGfx.Dispose()
    $tempBmp.Dispose()

    $width  = [int][Math]::Ceiling($size.Width) + $Padding * 2
    $height = [int][Math]::Ceiling($size.Height) + $Padding * 2

    $bmp = New-Object System.Drawing.Bitmap $width, $height
    $gfx = [System.Drawing.Graphics]::FromImage($bmp)
    $gfx.SmoothingMode    = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $gfx.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $gfx.Clear($colorBG)

    $brush = New-Object System.Drawing.SolidBrush $colorFG
    $rect = New-Object System.Drawing.RectangleF $Padding, $Padding, ($width - $Padding * 2), ($height - $Padding * 2)
    $gfx.DrawString($body, $fontObj, $brush, $rect, $format)

    $outDir = Split-Path -Parent $OutputPath
    if ($outDir -and -not (Test-Path $outDir)) {
        New-Item -ItemType Directory -Force -Path $outDir | Out-Null
    }
    $bmp.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)

    $brush.Dispose()
    $fontObj.Dispose()
    $gfx.Dispose()
    $bmp.Dispose()

    $sizeKB = [math]::Round((Get-Item $OutputPath).Length / 1KB, 1)
    Write-Output "Saved $OutputPath  (${width}x${height}, ${sizeKB} KB, font: $chosenFont)"
}
