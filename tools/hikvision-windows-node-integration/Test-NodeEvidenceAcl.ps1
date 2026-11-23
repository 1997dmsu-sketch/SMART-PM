param()

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$WarningPreference = 'SilentlyContinue'

# Offline compatibility verification only. Never imports the probe CLI/transport,
# reads live configuration, accepts an output path, or handles an old reference.
function Get-ByteHash {
    param([string] $Path)
    $stream = [IO.File]::OpenRead($Path)
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
    finally { $algorithm.Dispose(); $stream.Dispose() }
}

function Invoke-SyntheticWriter {
    param([string] $Stage, [string] $RootPath, [string] $NodePath, [string] $WriterPath)
    if ($RootPath.Contains('"') -or $WriterPath.Contains('"')) { throw 'INVALID_CHILD_ARGUMENT' }
    $process = [Diagnostics.Process]::new()
    $process.StartInfo.FileName = $NodePath
    $process.StartInfo.Arguments = '"' + $WriterPath + '" ' + $Stage + ' "' + $RootPath + '"'
    $process.StartInfo.UseShellExecute = $false
    $process.StartInfo.CreateNoWindow = $true
    $process.StartInfo.RedirectStandardOutput = $true
    $process.StartInfo.RedirectStandardError = $true
    try {
        if (-not $process.Start()) { throw 'CHILD_START_FAILED' }
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(15000)) {
            try { $process.Kill() } catch { }
            if (-not $process.WaitForExit(5000)) { throw 'CHILD_NOT_QUIESCENT' }
            throw 'CHILD_DEADLINE_EXCEEDED'
        }
        $childExit = $process.ExitCode
        $outText = $stdout.GetAwaiter().GetResult()
        $errText = $stderr.GetAwaiter().GetResult()
        if ($childExit -ne 0 -or $errText.Length -ne 0) { throw 'CHILD_FAILED' }
        $summary = $outText | ConvertFrom-Json -ErrorAction Stop
        if ($summary.scope -cne 'synthetic-original-node-writer-only' -or
            $summary.status -cne 'PASS' -or $summary.stage -cne $Stage -or
            $summary.code -cne 'OK' -or $summary.nodeVersion -notmatch '\Av[0-9]+\.[0-9]+\.[0-9]+\z') {
            throw 'CHILD_OUTPUT_INVALID'
        }
        $ensureCount = 0; $writeCount = 2; $fileCount = 2
        if ($Stage -ceq 'ensure') { $ensureCount = 1; $writeCount = 0; $fileCount = 0 }
        if ($summary.counts.ensureCalls -ne $ensureCount -or
            $summary.counts.writeCalls -ne $writeCount -or $summary.counts.filesObserved -ne $fileCount) {
            throw 'CHILD_COUNTS_INVALID'
        }
        return [pscustomobject]@{ stage = $Stage; exitCode = $childExit; result = $summary }
    }
    finally { $process.Dispose() }
}

function Assert-NewRoot {
    if (-not (Test-HkAncestorChain $script:rootPath) -or
        [IO.Directory]::GetCreationTimeUtc($script:rootPath).Ticks -ne $script:rootCreatedAt) {
        throw 'ROOT_CHANGED'
    }
    $snapshot = Get-HkNativeAclSnapshot $script:rootPath 'Directory'
    if (-not (EvidenceAcl\Test-HkAclPolicy $snapshot $script:userSid 'Directory').Valid) { throw 'ROOT_ACL_INVALID' }
    return $snapshot
}

function Assert-KnownFiles {
    param([bool] $RequireSameCreationTime)
    $null = Assert-NewRoot
    $entries = @([IO.Directory]::GetFileSystemEntries($script:rootPath))
    if ($entries.Count -ne 2 -or $entries -cnotcontains $script:sentinelPath -or
        $entries -cnotcontains $script:reportPath) { throw 'UNKNOWN_ENTRY' }
    foreach ($path in @($script:sentinelPath, $script:reportPath)) {
        $snapshot = Get-HkNativeAclSnapshot $path 'File'
        if (-not (EvidenceAcl\Test-HkAclPolicy $snapshot $script:userSid 'File').Valid) { throw 'FILE_ACL_INVALID' }
        $ticks = [IO.File]::GetCreationTimeUtc($path).Ticks
        if ($RequireSameCreationTime) {
            if ($ticks -ne $script:fileTimes[$path]) { throw 'FILE_CHANGED' }
        }
        else { $script:fileTimes[$path] = $ticks }
    }
}

function Assert-SyntheticContent {
    param([int] $Revision)
    $sentinel = [Text.Encoding]::ASCII.GetBytes(('SMART-PM synthetic Node ACL sentinel v' + $Revision + "`r`n"))
    $report = [Text.Encoding]::ASCII.GetBytes(('{"scope":"synthetic-node-write-only","revision":' + $Revision + "}`r`n"))
    foreach ($entry in @(@($script:sentinelPath, $sentinel), @($script:reportPath, $report))) {
        $actual = [IO.File]::ReadAllBytes($entry[0])
        if ([Convert]::ToBase64String($actual) -cne [Convert]::ToBase64String($entry[1])) { throw 'CONTENT_INVALID' }
    }
}

$result = [ordered]@{
    scope = 'synthetic-original-node-windows-acl-integration-only'
    status = 'BLOCKED'; code = 'PLATFORM_UNSUPPORTED'
    integrationState = 'LIVE_CLI_NOT_INTEGRATED'
    checks = [ordered]@{
        platformSupported = $false; sourcesPinned = $false; identitySupported = $false
        locationSupported = $false; directoryCreatedProtected = $false
        originalEnsurePreservedAcl = $false; nodeCreatedFilesInheritedAcl = $false
        nodeRewritePreservedAcl = $false; contentsVerified = $false
        broadenedAclRejected = $false; cleanupVerified = $false
    }
    counts = [ordered]@{
        directoriesCreated = 0; filesCreated = 0; filesRewritten = 0
        filesDeleted = 0; directoriesDeleted = 0; nodeProcesses = 0
        ensureCalls = 0; writeCalls = 0; negativeControls = 0
    }
    evidenceRef = ('hk-node-acl-' + [guid]::NewGuid().ToString('N'))
    nodeVersion = ''; nodeCandidateCount = 0; stages = @(); nodeInvocationAttempts = 0; newObjectStateUnverified = $false
    errorType = ''; deviceRequests = 0; e1 = 'NOT_EXECUTED'; e2 = 'NOT_EXECUTED'
}
$exitCode = 2
$rootPath = $null; $userSid = $null; $rootCreatedAt = 0
$sentinelPath = $null; $reportPath = $null; $fileTimes = @{}
$failureCode = 'SOURCE_OR_CAPABILITY_UNAVAILABLE'
$expectedWorkerHash = '27b3d06237939a122e1fbfbc10db3bc03f15c5dfe7611b959740950aa8914f0e'

try {
    do {
        if (@($args).Count -ne 0) { $result.code = 'ARGUMENTS_UNSUPPORTED'; break }
        if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT -or
            $PSVersionTable.PSEdition -cne 'Desktop' -or $PSVersionTable.PSVersion.Major -ne 5 -or
            $PSVersionTable.PSVersion.Minor -ne 1) { break }
        $result.checks.platformSupported = $true
        $helperPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\hikvision-windows-evidence-preflight\Test-EvidenceAcl.ps1'))
        $modulePath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\hikvision-windows-evidence-preflight\EvidenceAcl.psm1'))
        $referencePath = Join-Path $PSScriptRoot 'reference\fs-safe.mjs'
        $writerPath = Join-Path $PSScriptRoot 'writer.mjs'
        if ((Get-ByteHash $helperPath) -cne 'e14793c80cd652c930d2fa8fa0ee670d7f077da216ccf6d7c6ff53c43d142a4b' -or
            (Get-ByteHash $modulePath) -cne 'ca1a81bee7cc7f668067a07b956a971740c6ebdfca8c73ca64e9f745ff101bf9' -or
            (Get-ByteHash $referencePath) -cne 'd618507e8ad74479945a36bbc1dd080e4b93b03e241ac53642c7d59b5d98613d' -or
            (Get-ByteHash $writerPath) -cne $expectedWorkerHash) { $result.code = 'SOURCE_HASH_MISMATCH'; break }
        $tokens = $null; $parseErrors = $null
        $tree = [System.Management.Automation.Language.Parser]::ParseFile($helperPath, [ref]$tokens, [ref]$parseErrors)
        if (@($parseErrors).Count -ne 0) { throw 'HELPER_PARSE_FAILED' }
        foreach ($name in @('Test-HkLocalPathText', 'Test-HkAncestorChain', 'Get-HkNativeAclSnapshot', 'New-HkProtectedDirectorySecurity')) {
            $definitions = @($tree.FindAll({ param($node)
                $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name
            }, $false))
            if ($definitions.Count -ne 1) { throw 'HELPER_DEFINITION_INVALID' }
            # Define only these four hash-pinned functions, never the main script.
            . ([scriptblock]::Create($definitions[0].Extent.Text))
        }
        Import-Module -Name $modulePath -ErrorAction Stop
        $nodeCandidates = @(Get-Command node.exe -CommandType Application -ErrorAction Stop)
        $result.nodeCandidateCount = $nodeCandidates.Count
        # Match ordinary PATH precedence; never stringify an array of paths and
        # never fall back to another candidate after a launch/security failure.
        $nodeCommand = $nodeCandidates[0]
        if ($nodeCommand -isnot [System.Management.Automation.ApplicationInfo] -or
            -not [IO.File]::Exists($nodeCommand.Source)) { $result.code = 'NODE_EXECUTABLE_UNAVAILABLE'; break }
        $result.checks.sourcesPinned = $true

        $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
        try {
            $userSid = [string]$identity.User.Value
            $principal = [Security.Principal.WindowsPrincipal]::new($identity)
            if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { $result.code = 'ELEVATED_TOKEN_UNSUPPORTED'; break }
        }
        finally { $identity.Dispose() }
        if (-not [regex]::IsMatch($userSid, '\AS-1-(?:5-21|12-1)-(?:0|[1-9][0-9]{0,9})-(?:0|[1-9][0-9]{0,9})-(?:0|[1-9][0-9]{0,9})-(?:0|[1-9][0-9]{0,9})\z')) {
            $result.code = 'IDENTITY_UNSUPPORTED'; break
        }
        $result.checks.identitySupported = $true
        $basePath = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData, [Environment+SpecialFolderOption]::DoNotVerify)
        if (-not (Test-HkLocalPathText $basePath)) { $result.code = 'LOCATION_UNSUPPORTED'; break }
        $basePath = [IO.Path]::GetFullPath($basePath).TrimEnd('\')
        $drive = [IO.DriveInfo]::new([IO.Path]::GetPathRoot($basePath))
        if (-not $drive.IsReady -or $drive.DriveType -ne [IO.DriveType]::Fixed -or $drive.DriveFormat -cne 'NTFS' -or
            -not (Test-HkAncestorChain $basePath)) { $result.code = 'LOCATION_UNSUPPORTED'; break }
        $result.checks.locationSupported = $true
        $rootPath = [IO.Path]::Combine($basePath, $result.evidenceRef)
        $sentinelPath = [IO.Path]::Combine($rootPath, 'sentinel.raw')
        $reportPath = [IO.Path]::Combine($rootPath, 'report.json')
        if ([IO.Directory]::Exists($rootPath) -or [IO.File]::Exists($rootPath)) { $result.code = 'NAME_COLLISION'; break }
        $failureCode = 'CREATE_OR_ACL_FAILED'
        $security = New-HkProtectedDirectorySecurity $userSid
        if (-not (Test-HkAncestorChain $basePath)) { throw 'ANCESTOR_CHANGED' }
        $result.newObjectStateUnverified = $true
        $null = [IO.Directory]::CreateDirectory($rootPath, $security)
        $result.counts.directoriesCreated = 1
        $rootCreatedAt = [IO.Directory]::GetCreationTimeUtc($rootPath).Ticks
        $directorySnapshot = Assert-NewRoot
        if (@([IO.Directory]::GetFileSystemEntries($rootPath)).Count -ne 0) { throw 'ROOT_NOT_EMPTY' }
        $result.checks.directoryCreatedProtected = $true

        $failureCode = 'NODE_ENSURE_FAILED'
        $result.nodeInvocationAttempts++
        $stage = Invoke-SyntheticWriter 'ensure' $rootPath $nodeCommand.Source $writerPath
        $result.stages += $stage; $result.counts.nodeProcesses++; $result.counts.ensureCalls++
        $result.nodeVersion = $stage.result.nodeVersion
        $null = Assert-NewRoot
        if (@([IO.Directory]::GetFileSystemEntries($rootPath)).Count -ne 0) { throw 'ROOT_NOT_EMPTY' }
        $result.checks.originalEnsurePreservedAcl = $true

        $failureCode = 'NODE_WRITE_OR_ACL_FAILED'
        $null = Assert-NewRoot
        $result.nodeInvocationAttempts++
        $stage = Invoke-SyntheticWriter 'write' $rootPath $nodeCommand.Source $writerPath
        $result.stages += $stage; $result.counts.nodeProcesses++; $result.counts.writeCalls += 2
        Assert-KnownFiles $false
        Assert-SyntheticContent 1
        $result.counts.filesCreated = 2
        $result.checks.nodeCreatedFilesInheritedAcl = $true

        $failureCode = 'NODE_REWRITE_OR_ACL_FAILED'
        Assert-KnownFiles $true
        $result.nodeInvocationAttempts++
        $stage = Invoke-SyntheticWriter 'rewrite' $rootPath $nodeCommand.Source $writerPath
        $result.stages += $stage; $result.counts.nodeProcesses++; $result.counts.writeCalls += 2
        Assert-KnownFiles $true
        Assert-SyntheticContent 2
        $result.counts.filesRewritten = 2
        $result.checks.nodeRewritePreservedAcl = $true
        $result.checks.contentsVerified = $true

        $failureCode = 'NEGATIVE_CONTROL_FAILED'
        $negative = [pscustomobject]@{
            OwnerSid = $directorySnapshot.OwnerSid; DaclPresent = $true; DaclProtected = $true
            Canonical = $true; ReparsePoint = $false
            Rules = [object[]](@($directorySnapshot.Rules) + @([pscustomobject]@{
                Sid = 'S-1-1-0'; Type = 'Allow'; Rights = 2032127; IsInherited = $false
                InheritanceFlags = 3; PropagationFlags = 0
            }))
        }
        $result.counts.negativeControls = 1
        if ((EvidenceAcl\Test-HkAclPolicy $negative $userSid 'Directory').Valid) { throw 'NEGATIVE_ACCEPTED' }
        $result.checks.broadenedAclRejected = $true

        # Only the all-success path cleans its own known new objects. Any earlier
        # failure retains the new reference; no fallback cleanup or recursive rm.
        $failureCode = 'CLEANUP_FAILED'
        Assert-KnownFiles $true
        Assert-SyntheticContent 2
        foreach ($path in @($sentinelPath, $reportPath)) {
            $null = Assert-NewRoot
            $snapshot = Get-HkNativeAclSnapshot $path 'File'
            if (-not (EvidenceAcl\Test-HkAclPolicy $snapshot $userSid 'File').Valid -or
                [IO.File]::GetCreationTimeUtc($path).Ticks -ne $fileTimes[$path]) { throw 'FILE_CHANGED' }
            $entries = @([IO.Directory]::GetFileSystemEntries($rootPath))
            foreach ($entry in $entries) {
                if ($entry -cne $sentinelPath -and $entry -cne $reportPath) { throw 'UNKNOWN_ENTRY' }
            }
            [IO.File]::Delete($path)
            $result.counts.filesDeleted++
        }
        $null = Assert-NewRoot
        if (@([IO.Directory]::GetFileSystemEntries($rootPath)).Count -ne 0) { throw 'ROOT_NOT_EMPTY' }
        [IO.Directory]::Delete($rootPath, $false)
        $result.counts.directoriesDeleted = 1
        if ([IO.Directory]::Exists($rootPath) -or [IO.File]::Exists($rootPath)) { throw 'CLEANUP_UNVERIFIED' }
        $result.checks.cleanupVerified = $true
        $result.newObjectStateUnverified = $false
        $result.status = 'PASS'; $result.code = 'OK'; $exitCode = 0
    } while ($false)
}
catch {
    $result.errorType = $_.Exception.GetType().FullName
    $result.status = 'FAIL'; $result.code = $failureCode; $exitCode = 3
}

try { [Console]::Out.WriteLine(($result | ConvertTo-Json -Depth 8 -Compress)) }
catch { exit 3 }
exit $exitCode
