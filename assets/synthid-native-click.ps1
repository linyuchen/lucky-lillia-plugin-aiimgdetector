param(
    [Parameter(Mandatory = $true)][ValidateRange(1, 2147483647)][int]$BrowserProcessId,
    [ValidateRange(1, 300)][int]$TimeoutSeconds = 15
)

$OutputEncoding = [System.Text.UTF8Encoding]::new()
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$ErrorActionPreference = 'Stop'
trap { [Console]::Error.WriteLine('SynthID browser file selection click failed.'); exit 1 }

$synthIdBrowser = Get-Process -Id $BrowserProcessId
if ($synthIdBrowser.ProcessName -notin @('msedge', 'chrome', 'chromium')) { throw 'Invalid browser process.' }
$synthIdExecutable = $synthIdBrowser.Path
$synthIdStarted = $synthIdBrowser.StartTime.ToUniversalTime().Ticks
if ([string]::IsNullOrEmpty($synthIdExecutable)) { throw 'Browser executable unavailable.' }

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
public static class SynthIdNativeClick {
    private delegate bool EnumCallback(IntPtr hwnd, IntPtr state);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumCallback callback, IntPtr state);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetClassName(IntPtr hwnd, StringBuilder name, int capacity);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
    [DllImport("user32.dll")] private static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll")] private static extern IntPtr WindowFromPoint(POINT point);
    [DllImport("user32.dll")] private static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
    [DllImport("user32.dll", SetLastError=true)] private static extern uint SendInput(uint count, INPUT[] inputs, int size);
    [DllImport("user32.dll")] private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [StructLayout(LayoutKind.Sequential)] private struct RECT { public int left, top, right, bottom; }
    [StructLayout(LayoutKind.Sequential)] private struct POINT { public int x, y; }
    [StructLayout(LayoutKind.Sequential)] private struct INPUT { public uint type; public MOUSEINPUT mouse; }
    [StructLayout(LayoutKind.Sequential)] private struct MOUSEINPUT { public int dx, dy; public uint mouseData, flags, time; public UIntPtr extraInfo; }

    public static void PhysicalCoordinates() { SetThreadDpiAwarenessContext(new IntPtr(-4)); }

    public static IntPtr[] Windows(int processId) {
        var result = new List<IntPtr>();
        EnumWindows((window, state) => {
            uint owner;
            GetWindowThreadProcessId(window, out owner);
            if (owner != processId || !IsWindowVisible(window)) return true;
            var name = new StringBuilder(256);
            GetClassName(window, name, name.Capacity);
            if (name.ToString() == "Chrome_WidgetWin_1") result.Add(window);
            return true;
        }, IntPtr.Zero);
        return result.ToArray();
    }

    public static void Click(IntPtr window, int processId, double left, double top, double width, double height) {
        uint owner;
        GetWindowThreadProcessId(window, out owner);
        if (owner != processId || !IsWindowVisible(window)) throw new InvalidOperationException("Browser ownership changed.");
        RECT windowRect;
        if (!GetWindowRect(window, out windowRect)) throw new InvalidOperationException("Browser bounds unavailable.");
        if (Double.IsNaN(left) || Double.IsNaN(top) || Double.IsNaN(width) || Double.IsNaN(height) ||
            Double.IsInfinity(left) || Double.IsInfinity(top) || Double.IsInfinity(width) || Double.IsInfinity(height) ||
            width <= 0 || height <= 0 || left < windowRect.left || top < windowRect.top ||
            left + width > windowRect.right || top + height > windowRect.bottom)
            throw new InvalidOperationException("Button is outside the browser.");
        int x = (int)Math.Round(left + width / 2), y = (int)Math.Round(top + height / 2);
        int screenLeft = GetSystemMetrics(76), screenTop = GetSystemMetrics(77);
        int screenWidth = GetSystemMetrics(78), screenHeight = GetSystemMetrics(79);
        if (screenWidth <= 1 || screenHeight <= 1 || x < screenLeft || x >= screenLeft + screenWidth ||
            y < screenTop || y >= screenTop + screenHeight)
            throw new InvalidOperationException("Button is outside the desktop.");
        SetForegroundWindow(window);
        for (int i = 0; i < 20 && GetForegroundWindow() != window; i++) Thread.Sleep(50);
        if (GetForegroundWindow() != window) throw new InvalidOperationException("Browser is not foreground.");
        int normalizedX = (int)Math.Round((x - screenLeft) * 65535.0 / (screenWidth - 1));
        int normalizedY = (int)Math.Round((y - screenTop) * 65535.0 / (screenHeight - 1));
        var inputs = new INPUT[3];
        inputs[0].mouse = new MOUSEINPUT { dx = normalizedX, dy = normalizedY, flags = 0x8000 | 0x4000 | 0x0001 };
        inputs[1].mouse = new MOUSEINPUT { flags = 0x0002 };
        inputs[2].mouse = new MOUSEINPUT { flags = 0x0004 };
        if (GetForegroundWindow() != window || GetAncestor(WindowFromPoint(new POINT { x = x, y = y }), 2) != window)
            throw new InvalidOperationException("Browser foreground or button visibility changed.");
        if (SendInput(3, inputs, Marshal.SizeOf(typeof(INPUT))) != 3)
            throw new InvalidOperationException("Mouse input was not delivered.");
    }
}
'@

[SynthIdNativeClick]::PhysicalCoordinates()
$synthIdDeadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
$synthIdButton = $null
$synthIdWindow = [IntPtr]::Zero
$synthIdLocalizedButtonName = -join ([char[]]@(0x9009, 0x62e9, 0x6587, 0x4ef6))
$synthIdButtonNames = [System.Windows.Automation.OrCondition]::new(
    [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, 'Select file'),
    [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, $synthIdLocalizedButtonName)
)
$synthIdCondition = [System.Windows.Automation.AndCondition]::new(
    [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button),
    $synthIdButtonNames
)
while ([DateTime]::UtcNow -lt $synthIdDeadline) {
    $synthIdCurrent = Get-Process -Id $BrowserProcessId
    if ($synthIdCurrent.Path -ne $synthIdExecutable -or $synthIdCurrent.StartTime.ToUniversalTime().Ticks -ne $synthIdStarted) { throw 'Browser process changed.' }
    $synthIdWindows = @([SynthIdNativeClick]::Windows($BrowserProcessId))
    if ($synthIdWindows.Count -gt 1) { throw 'Browser window is ambiguous.' }
    if ($synthIdWindows.Count -eq 1) {
        $synthIdWindow = $synthIdWindows[0]
        $synthIdRoot = [System.Windows.Automation.AutomationElement]::FromHandle($synthIdWindow)
        $synthIdCandidates = $synthIdRoot.FindAll([System.Windows.Automation.TreeScope]::Descendants, $synthIdCondition)
        $synthIdButtons = @($synthIdCandidates | Where-Object { $_.Current.IsEnabled -and -not $_.Current.IsOffscreen })
        if ($synthIdButtons.Count -gt 1) { throw 'File selection button is ambiguous.' }
        if ($synthIdButtons.Count -eq 1) { $synthIdButton = $synthIdButtons[0]; break }
    }
    Start-Sleep -Milliseconds 100
}
if ($null -eq $synthIdButton) { throw 'File selection button unavailable.' }
$synthIdButton.SetFocus()
$synthIdBounds = $synthIdButton.Current.BoundingRectangle
[SynthIdNativeClick]::Click($synthIdWindow, $BrowserProcessId, $synthIdBounds.Left, $synthIdBounds.Top, $synthIdBounds.Width, $synthIdBounds.Height)
