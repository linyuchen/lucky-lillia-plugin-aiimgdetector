[CmdletBinding(DefaultParameterSetName = 'Select')]
param(
    [Parameter(Mandatory = $true)][ValidateRange(1, 2147483647)][int]$BrowserProcessId,
    [Parameter(Mandatory = $true, ParameterSetName = 'Select')][string]$FilePath,
    [Parameter(Mandatory = $true, ParameterSetName = 'Cancel')][switch]$Cancel,
    [ValidateRange(1, 300)][int]$TimeoutSeconds = 15
)

$OutputEncoding = [System.Text.UTF8Encoding]::new()
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$ErrorActionPreference = 'Stop'
trap { [Console]::Error.WriteLine('SynthID native file dialog operation failed.'); exit 1 }

$synthIdBrowser = Get-Process -Id $BrowserProcessId -ErrorAction SilentlyContinue
if ($null -eq $synthIdBrowser) {
    if ($Cancel) { exit 0 }
    throw 'Browser process unavailable.'
}
if ($synthIdBrowser.ProcessName -notin @('msedge', 'chrome', 'chromium')) { throw 'Invalid browser process.' }
$synthIdExecutable = $synthIdBrowser.Path
$synthIdStarted = $synthIdBrowser.StartTime.ToUniversalTime().Ticks
if ([string]::IsNullOrEmpty($synthIdExecutable)) { throw 'Browser executable unavailable.' }
if (-not $Cancel) {
    $synthIdFile = Get-Item -LiteralPath $FilePath
    if ($synthIdFile.PSIsContainer) { throw 'Selection requires a file.' }
    $synthIdAbsolutePath = $synthIdFile.FullName
}

Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class SynthIdNativeSelect {
    private delegate bool EnumCallback(IntPtr hwnd, IntPtr state);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumCallback callback, IntPtr state);
    [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr hwnd, EnumCallback callback, IntPtr state);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetClassName(IntPtr hwnd, StringBuilder name, int capacity);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr hwnd, uint command);
    [DllImport("user32.dll")] private static extern int GetDlgCtrlID(IntPtr hwnd);
    [DllImport("user32.dll", CharSet=CharSet.Unicode, EntryPoint="SendMessageTimeoutW")] private static extern IntPtr SendText(IntPtr hwnd, uint message, IntPtr wparam, string text, uint flags, uint timeout, out IntPtr result);
    [DllImport("user32.dll", CharSet=CharSet.Unicode, EntryPoint="SendMessageTimeoutW")] private static extern IntPtr ReadText(IntPtr hwnd, uint message, IntPtr wparam, StringBuilder text, uint flags, uint timeout, out IntPtr result);
    [DllImport("user32.dll", SetLastError=true)] private static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr wparam, IntPtr lparam);

    private static bool OwnedByBrowser(IntPtr window, int browserProcessId) {
        for (int depth = 0; depth < 20 && window != IntPtr.Zero; depth++) {
            uint processId;
            GetWindowThreadProcessId(window, out processId);
            if (processId == browserProcessId) return true;
            window = GetWindow(window, 4);
        }
        return false;
    }

    public static IntPtr[] Find(int processId, int browserProcessId) {
        var matches = new List<IntPtr>();
        EnumWindows((window, state) => {
            uint owner;
            GetWindowThreadProcessId(window, out owner);
            if (owner != processId || !IsWindowVisible(window)) return true;
            var className = new StringBuilder(256);
            GetClassName(window, className, className.Capacity);
            if (className.ToString() == "#32770" && OwnedByBrowser(window, browserProcessId)) matches.Add(window);
            return true;
        }, IntPtr.Zero);
        return matches.ToArray();
    }

    private static IntPtr Control(IntPtr dialog, string expectedClass, int controlId, int hostPid) {
        var matches = new List<IntPtr>();
        EnumChildWindows(dialog, (window, state) => {
            uint processId;
            GetWindowThreadProcessId(window, out processId);
            if (processId != hostPid || !IsWindowVisible(window) || GetDlgCtrlID(window) != controlId) return true;
            var className = new StringBuilder(256);
            GetClassName(window, className, className.Capacity);
            if (className.ToString() == expectedClass) matches.Add(window);
            return true;
        }, IntPtr.Zero);
        if (matches.Count != 1) throw new InvalidOperationException("Native dialog control unavailable or ambiguous.");
        return matches[0];
    }

    public static void Apply(IntPtr dialog, int browserPid, int hostPid, string path, bool cancel) {
        uint actualHost;
        GetWindowThreadProcessId(dialog, out actualHost);
        if (actualHost != hostPid || !IsWindowVisible(dialog) || !OwnedByBrowser(dialog, browserPid))
            throw new InvalidOperationException("Native dialog ownership changed.");
        var edit = Control(dialog, "Edit", 1148, hostPid);
        var open = Control(dialog, "Button", 1, hostPid);
        var cancelButton = Control(dialog, "Button", 2, hostPid);
        if (!cancel) {
            IntPtr result;
            if (SendText(edit, 0x000C, IntPtr.Zero, path, 2, 2000, out result) == IntPtr.Zero || result == IntPtr.Zero)
                throw new InvalidOperationException("Native filename input rejected selection.");
            var value = new StringBuilder(path.Length + 2);
            if (ReadText(edit, 0x000D, new IntPtr(value.Capacity), value, 2, 2000, out result) == IntPtr.Zero || value.ToString() != path)
                throw new InvalidOperationException("Native filename input did not retain selection.");
        }
        if (!OwnedByBrowser(dialog, browserPid) || !PostMessage(cancel ? cancelButton : open, 0x00F5, IntPtr.Zero, IntPtr.Zero))
            throw new InvalidOperationException("Native file dialog action failed.");
    }
}
'@

$synthIdDeadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
do {
    $synthIdCurrent = Get-Process -Id $BrowserProcessId -ErrorAction SilentlyContinue
    if ($null -eq $synthIdCurrent) {
        if ($Cancel) { exit 0 }
        throw 'Browser process ended.'
    }
    if ($synthIdCurrent.Path -ne $synthIdExecutable -or $synthIdCurrent.StartTime.ToUniversalTime().Ticks -ne $synthIdStarted) { throw 'Browser process changed.' }
    $synthIdHostIds = @($BrowserProcessId)
    $synthIdChildren = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$BrowserProcessId")
    foreach ($synthIdChild in $synthIdChildren) {
        if ($synthIdChild.ExecutablePath -eq $synthIdExecutable) { $synthIdHostIds += [int]$synthIdChild.ProcessId }
    }
    $synthIdDialogs = @()
    foreach ($synthIdHostId in $synthIdHostIds) {
        foreach ($synthIdWindow in @([SynthIdNativeSelect]::Find($synthIdHostId, $BrowserProcessId))) {
            $synthIdDialogs += [PSCustomObject]@{ Handle=$synthIdWindow; ProcessId=$synthIdHostId }
        }
    }
    if ($synthIdDialogs.Count -gt 1) { throw 'Native dialog is ambiguous.' }
    if ($synthIdDialogs.Count -eq 1) {
        $synthIdDialog = $synthIdDialogs[0]
        [SynthIdNativeSelect]::Apply($synthIdDialog.Handle, $BrowserProcessId, $synthIdDialog.ProcessId, $synthIdAbsolutePath, [bool]$Cancel)
        exit 0
    }
    if ($Cancel) { exit 0 }
    Start-Sleep -Milliseconds 100
} while ([DateTime]::UtcNow -lt $synthIdDeadline)
throw 'Native file dialog unavailable.'
