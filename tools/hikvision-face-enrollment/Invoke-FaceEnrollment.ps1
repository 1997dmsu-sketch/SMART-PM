[CmdletBinding()]
param(
    [switch]$PrivateConsoleInput,
    [string]$OutputDirectory,
    [ValidateRange(1, 48)]
    [int]$TimeoutSeconds = 48
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
$previousInputEncoding = [Console]::InputEncoding
$previousOutputEncoding = [Console]::OutputEncoding
$previousPipelineEncoding = $OutputEncoding
$child = $null
$childStarted = $false
$stdoutTask = $null
$stderrTask = $null
$inputBytes = $null
$payload = $null
$stdoutText = ''
$stderrText = ''
$streams = @{}
$wrapperExitCode = 2
$terminalFailure = $false
$errorCategory = 'wrapper-initialization-failed'
$summary = [ordered]@{ childExitCode = $null; wrapperExitCode = 2; evidenceRef = $null; timedOut = $false; error = $null }

function Quote-WindowsArgument([string]$Value) {
    $result = New-Object System.Text.StringBuilder
    [void]$result.Append('"')
    $slashes = 0
    foreach ($character in $Value.ToCharArray()) {
        if ($character -eq '\') { $slashes++; continue }
        if ($character -eq '"') {
            [void]$result.Append(('\' * (2 * $slashes + 1)))
            [void]$result.Append('"')
        } else {
            [void]$result.Append(('\' * $slashes))
            [void]$result.Append($character)
        }
        $slashes = 0
    }
    [void]$result.Append(('\' * (2 * $slashes)))
    [void]$result.Append('"')
    return $result.ToString()
}

function Read-BoundedStandardInput([int]$Maximum) {
    # Console.In can replace invalid UTF-8 before the CLI sees it. Read bounded
    # original bytes instead, and reject invalid encodings before child startup.
    $inputStream = [Console]::OpenStandardInput()
    $bytes = New-Object byte[] ($Maximum + 1)
    try {
        $length = 0
        while ($length -lt $bytes.Length) {
            $count = $inputStream.Read($bytes, $length, $bytes.Length - $length)
            if ($count -eq 0) { break }
            $length += $count
        }
        if ($length -gt $Maximum) { throw 'input-limit' }
        $strictUtf8 = New-Object System.Text.UTF8Encoding($false, $true)
        return $strictUtf8.GetString($bytes, 0, $length)
    } finally {
        [Array]::Clear($bytes, 0, $bytes.Length)
    }
}

function Write-OwnedStream($Stream, [string]$Text) {
    $writer = New-Object System.IO.StreamWriter -ArgumentList $Stream, $utf8
    try { $writer.Write($Text); $writer.Flush() } finally { $writer.Dispose() }
}

function Test-DeviceOrUncPath([string]$Value) {
    if ($Value -match '^(?:[\\/]{2}|[\\/]\?\?[\\/]|[\\/]Device[\\/])') { return $true }
    if ($Value -match '(?:^|[\\/])(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.[^\\/]*)?(?:[\\/]|$)') { return $true }
    return $false
}

function Assert-LocalAbsolutePath([string]$Value) {
    if ((Test-DeviceOrUncPath $Value) -or $Value -notmatch '^[A-Za-z]:[\\/]') { throw 'output-directory-local-only' }
}

function Test-ChildProtocol([string]$Text, [int]$ExitCode) {
    $single = $Text.Trim()
    if (-not $single.StartsWith('{') -or -not $single.EndsWith('}') -or $single.Contains("`n") -or $single.Contains("`r")) { return $false }
    try {
        $value = ConvertFrom-Json -InputObject $single -ErrorAction Stop
        if (-not (($value.protocolVersion -is [int]) -or ($value.protocolVersion -is [long])) -or $value.protocolVersion -ne 1 -or -not ($value.outcome -is [string])) { return $false }
        switch ($ExitCode) {
            0 {
                if ($value.outcome -eq 'simulation-completed') { return $value.mode -eq 'simulation' -and $value.siteVerification -eq 'NOT_APPLICABLE' }
                if ($value.outcome -eq 'device-enrollment-confirmed-pending-site') { return $value.mode -eq 'device' -and $value.siteVerification -eq 'PENDING' }
                return $false
            }
            2 { return $value.outcome -eq 'invalid-input' }
            4 { return $value.outcome -eq 'failed' }
            5 { return $value.outcome -eq 'stopped' }
            default { return $false }
        }
    } catch { return $false }
}

try {
    [Console]::InputEncoding = $utf8
    [Console]::OutputEncoding = $utf8
    $OutputEncoding = $utf8
    try {
        if (-not ('SmartPmFaceEnrollmentNativeV1' -as [type])) {
            Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class SmartPmFaceEnrollmentNativeV1
{
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr GetStdHandle(int standardHandle);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetConsoleMode(IntPtr handle, out uint mode);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetConsoleMode(IntPtr handle, uint mode);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool ReadConsoleW(IntPtr handle, [Out] char[] buffer, uint length, out uint read, IntPtr control);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool FlushConsoleInputBuffer(IntPtr handle);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateDirectoryW(string path, IntPtr attributes);

    public static void CreateNewDirectory(string path)
    {
        if (!CreateDirectoryW(path, IntPtr.Zero)) throw new Win32Exception(Marshal.GetLastWin32Error());
    }

    public static string ReadPrivateLine(int maximum)
    {
        IntPtr input = GetStdHandle(-10);
        uint originalMode;
        if (!GetConsoleMode(input, out originalMode)) throw new InvalidOperationException("console-unavailable");
        uint privateMode = (originalMode | 0x0001u | 0x0002u) & ~0x0004u;
        bool changed = false;
        char[] buffer = new char[maximum + 2];
        try
        {
            if (!SetConsoleMode(input, privateMode)) throw new InvalidOperationException("console-mode-failed");
            changed = true;
            Console.Error.WriteLine("PRIVATE_INPUT_READY");
            Console.Error.Flush();
            uint count;
            if (!ReadConsoleW(input, buffer, (uint)buffer.Length, out count, IntPtr.Zero)) throw new InvalidOperationException("console-read-failed");
            int length = (int)count;
            bool ended = length > 0 && (buffer[length - 1] == '\n' || buffer[length - 1] == '\r');
            while (length > 0 && (buffer[length - 1] == '\n' || buffer[length - 1] == '\r')) length--;
            if (!ended || length > maximum)
            {
                FlushConsoleInputBuffer(input);
                throw new InvalidOperationException("input-limit");
            }
            return new string(buffer, 0, length);
        }
        finally
        {
            Array.Clear(buffer, 0, buffer.Length);
            if (changed)
            {
                bool cleared = FlushConsoleInputBuffer(input);
                bool restored = SetConsoleMode(input, originalMode);
                if (!restored) throw new InvalidOperationException("console-restore-failed");
                if (!cleared) throw new InvalidOperationException("console-input-clear-failed");
            }
        }
    }
}
'@
        }

        $repository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
        $errorCategory = 'output-directory-local-only'
        Assert-LocalAbsolutePath $repository
        if (-not [string]::IsNullOrWhiteSpace($OutputDirectory) -and (Test-DeviceOrUncPath $OutputDirectory)) { throw 'output-directory-local-only' }
        $entryPoint = Join-Path $repository 'admin-web\face-enroll.mjs'
        $errorCategory = 'entry-point-unavailable'
        if (-not [IO.File]::Exists($entryPoint)) { throw 'entry-point-unavailable' }
        $node = (Get-Command node.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source

        $errorCategory = 'output-directory-unavailable'
        if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
            $runName = (Get-Date -Format 'yyyyMMddTHHmmssfff') + '-' + [Guid]::NewGuid().ToString('N')
            $destination = Join-Path $repository ('admin-web\.data\face-runs\' + $runName)
        } elseif ([IO.Path]::IsPathRooted($OutputDirectory)) {
            $destination = [IO.Path]::GetFullPath($OutputDirectory)
        } else {
            $destination = [IO.Path]::GetFullPath((Join-Path $repository $OutputDirectory))
        }
        $errorCategory = 'output-directory-local-only'
        Assert-LocalAbsolutePath $destination
        $errorCategory = 'output-directory-unavailable'
        if ([IO.File]::Exists($destination) -or [IO.Directory]::Exists($destination)) { throw 'output-directory-exists' }
        [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($destination))
        [SmartPmFaceEnrollmentNativeV1]::CreateNewDirectory($destination)
        $repoUri = New-Object System.Uri(($repository.TrimEnd('\') + '\'))
        $outputUri = New-Object System.Uri(($destination.TrimEnd('\') + '\'))
        $relative = $repoUri.MakeRelativeUri($outputUri)
        if ($relative.IsAbsoluteUri) {
            $summary.evidenceRef = '.'
            $summary['evidenceBase'] = 'output-directory'
        } else {
            $summary.evidenceRef = [Uri]::UnescapeDataString($relative.ToString())
            $summary['evidenceBase'] = 'repository'
        }
        foreach ($name in @('stdout.txt', 'stderr.txt', 'exit-code.txt')) {
            $streams[$name] = [IO.File]::Open((Join-Path $destination $name), [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        }

        $errorCategory = 'input-invalid-or-too-large'
        if ($PrivateConsoleInput) {
            try { $payload = [SmartPmFaceEnrollmentNativeV1]::ReadPrivateLine(32768) }
            catch {
                if ($_.Exception.GetBaseException().Message -in @('console-restore-failed', 'console-input-clear-failed')) {
                    $errorCategory = 'console-restore-failed'
                    $terminalFailure = $true
                }
                throw
            }
        }
        else { $payload = Read-BoundedStandardInput 32768 }
        $inputBytes = $utf8.GetBytes($payload)
        if ($inputBytes.Length -gt 32768) { throw 'input-limit' }

        $errorCategory = 'child-process-failed'
        $startInfo = New-Object System.Diagnostics.ProcessStartInfo
        $startInfo.FileName = $node
        # Only the script path belongs in argv. The complete request uses stdin.
        $startInfo.Arguments = Quote-WindowsArgument $entryPoint
        $startInfo.WorkingDirectory = $repository
        $startInfo.UseShellExecute = $false
        $startInfo.CreateNoWindow = $true
        $startInfo.RedirectStandardInput = $true
        $startInfo.RedirectStandardOutput = $true
        $startInfo.RedirectStandardError = $true
        $startInfo.StandardOutputEncoding = $utf8
        $startInfo.StandardErrorEncoding = $utf8
        $child = New-Object System.Diagnostics.Process
        $child.StartInfo = $startInfo
        $clock = [Diagnostics.Stopwatch]::StartNew()
        if (-not $child.Start()) { throw 'child-start-failed' }
        $childStarted = $true
        $stdoutTask = $child.StandardOutput.ReadToEndAsync()
        $stderrTask = $child.StandardError.ReadToEndAsync()
        # .NET Framework used by Windows PowerShell 5.1 has no
        # ProcessStartInfo.StandardInputEncoding. Write explicit UTF-8 bytes.
        $writeTask = $child.StandardInput.BaseStream.WriteAsync($inputBytes, 0, $inputBytes.Length)
        $remaining = [Math]::Max(0, ($TimeoutSeconds * 1000) - [int]$clock.ElapsedMilliseconds)
        if (-not $writeTask.Wait($remaining)) { $summary.timedOut = $true }
        if (-not $summary.timedOut) {
            $child.StandardInput.Close()
            $remaining = [Math]::Max(0, ($TimeoutSeconds * 1000) - [int]$clock.ElapsedMilliseconds)
            if (-not $child.WaitForExit($remaining)) { $summary.timedOut = $true }
        }
        if ($summary.timedOut) {
            $terminalFailure = $true
            $summary.error = 'child-timeout'
            if (-not $child.HasExited) { $child.Kill() }
            [void]$child.WaitForExit(2000)
        }
    } catch {
        $summary.error = $errorCategory
        if ($childStarted) { $terminalFailure = $true }
    } finally {
        if ($childStarted) {
            try {
                if (-not $child.HasExited) { $child.Kill(); [void]$child.WaitForExit(2000) }
                if ($child.HasExited) {
                    $summary.childExitCode = $child.ExitCode
                    $wrapperExitCode = $child.ExitCode
                } else { $summary.error = 'child-outcome-unknown'; $terminalFailure = $true }
            } catch { $summary.error = 'child-outcome-unknown'; $terminalFailure = $true }
            try {
                if ($stdoutTask -and $stdoutTask.Wait(1000)) { $stdoutText = $stdoutTask.Result }
                else { $summary.error = 'output-capture-incomplete'; $terminalFailure = $true }
                if ($stderrTask -and $stderrTask.Wait(1000)) { $stderrText = $stderrTask.Result }
                else { $summary.error = 'output-capture-incomplete'; $terminalFailure = $true }
            } catch { $summary.error = 'output-capture-incomplete'; $terminalFailure = $true }
            if (-not $terminalFailure -and $null -ne $summary.childExitCode -and -not (Test-ChildProtocol $stdoutText $summary.childExitCode)) {
                $summary.error = 'child-protocol-invalid'
                $terminalFailure = $true
            }
        }
        try {
            if ($streams.ContainsKey('stdout.txt')) { Write-OwnedStream $streams['stdout.txt'] $stdoutText }
            if ($streams.ContainsKey('stderr.txt')) { Write-OwnedStream $streams['stderr.txt'] $stderrText }
            if ($streams.ContainsKey('exit-code.txt')) {
                $exitText = if ($null -eq $summary.childExitCode) { 'not-started-or-unknown' } else { [string]$summary.childExitCode }
                Write-OwnedStream $streams['exit-code.txt'] ($exitText + "`n")
            }
        } catch { $summary.error = 'evidence-write-failed'; $terminalFailure = $true }
        foreach ($stream in $streams.Values) { try { $stream.Dispose() } catch {} }
        if ($null -ne $inputBytes) { [Array]::Clear($inputBytes, 0, $inputBytes.Length) }
        $payload = $null
        # On .NET Framework, disposing a reader with a pending pipe read can
        # block until an inheriting descendant closes the handle. This wrapper
        # exits its own process; never wait indefinitely for incomplete readers.
        $canDispose = (-not $childStarted) -or ($stdoutTask -and $stderrTask -and $stdoutTask.IsCompleted -and $stderrTask.IsCompleted)
        if ($null -ne $child -and $canDispose) { try { $child.Dispose() } catch { $summary.error = 'child-cleanup-failed'; $terminalFailure = $true } }
    }
} catch {
    $summary.error = 'wrapper-finalization-failed'
    $terminalFailure = $true
} finally {
    try { [Console]::InputEncoding = $previousInputEncoding } catch { $summary.error = 'encoding-restore-failed'; $terminalFailure = $true }
    try { [Console]::OutputEncoding = $previousOutputEncoding } catch { $summary.error = 'encoding-restore-failed'; $terminalFailure = $true }
    try { $OutputEncoding = $previousPipelineEncoding } catch { $summary.error = 'encoding-restore-failed'; $terminalFailure = $true }
}
if ($terminalFailure) { $wrapperExitCode = 5 }
$summary.wrapperExitCode = $wrapperExitCode
try {
    # Write explicit UTF-8 bytes after restoring the caller's console encodings.
    $resultBytes = $utf8.GetBytes(($summary | ConvertTo-Json -Compress -Depth 3) + "`n")
    $resultStream = [Console]::OpenStandardOutput()
    $resultStream.Write($resultBytes, 0, $resultBytes.Length)
    $resultStream.Flush()
} catch { $wrapperExitCode = 5 }
exit $wrapperExitCode
