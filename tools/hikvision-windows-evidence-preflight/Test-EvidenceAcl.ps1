param()

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$VerbosePreference = 'SilentlyContinue'
$DebugPreference = 'SilentlyContinue'
$WarningPreference = 'SilentlyContinue'

# This script creates only disposable synthetic evidence. It neither invokes
# the Node probe nor proves that real evidence, other accounts, SMB, privileged
# administrators, or hostile same-user/ancestor replacement are controlled.
function Test-HkLocalPathText {
    param([string] $Path)
    if ([string]::IsNullOrEmpty($Path) -or -not [regex]::IsMatch($Path, '\A[A-Za-z]:\\')) {
        return $false
    }
    if ($Path.Substring(2).Contains(':') -or $Path.Contains('/')) { return $false }
    foreach ($segment in $Path.Substring(3).Split('\')) {
        if ($segment -ceq '.' -or $segment -ceq '..' -or
            $segment.EndsWith('.') -or $segment.EndsWith(' ') -or
            [regex]::IsMatch($segment, '[<>:"/\\|?*\x00-\x1f]')) { return $false }
    }
    return $true
}

function Test-HkAncestorChain {
    param([string] $DirectoryPath)
    if (-not (Test-HkLocalPathText $DirectoryPath)) { return $false }
    $rootPath = [System.IO.Path]::GetPathRoot($DirectoryPath)
    $currentPath = $rootPath
    # Start at the already-approved local fixed drive. Never look up the full
    # descendant first: that could traverse a reparse point before it is checked.
    $attributes = [System.IO.File]::GetAttributes($currentPath)
    if (($attributes -band [System.IO.FileAttributes]::Directory) -eq 0 -or
        ($attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { return $false }
    $suffix = $DirectoryPath.Substring($rootPath.Length)
    foreach ($segment in $suffix.Split([char[]]@('\'), [System.StringSplitOptions]::RemoveEmptyEntries)) {
        $currentPath = [System.IO.Path]::Combine($currentPath, $segment)
        $attributes = [System.IO.File]::GetAttributes($currentPath)
        if (($attributes -band [System.IO.FileAttributes]::Directory) -eq 0 -or
            ($attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { return $false }
    }
    return $true
}

function Get-HkNativeAclSnapshot {
    param([string] $Path, [string] $Kind)
    $attributes = [System.IO.File]::GetAttributes($Path)
    if (($attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw [System.InvalidOperationException]::new()
    }
    $isDirectory = ($attributes -band [System.IO.FileAttributes]::Directory) -ne 0
    if ($isDirectory -ne ($Kind -ceq 'Directory')) { throw [System.InvalidOperationException]::new() }
    $sections = [System.Security.AccessControl.AccessControlSections]::Owner -bor
        [System.Security.AccessControl.AccessControlSections]::Access
    if ($Kind -ceq 'Directory') {
        $security = [System.IO.Directory]::GetAccessControl($Path, $sections)
    }
    else {
        $security = [System.IO.File]::GetAccessControl($Path, $sections)
    }
    $binary = $security.GetSecurityDescriptorBinaryForm()
    $raw = [System.Security.AccessControl.RawSecurityDescriptor]::new($binary, 0)
    $daclPresent = ($raw.ControlFlags -band [System.Security.AccessControl.ControlFlags]::DiscretionaryAclPresent) -ne 0
    $protected = ($raw.ControlFlags -band [System.Security.AccessControl.ControlFlags]::DiscretionaryAclProtected) -ne 0
    if (-not $daclPresent -or $null -eq $raw.DiscretionaryAcl -or $raw.DiscretionaryAcl.Count -ne 2) {
        throw [System.InvalidOperationException]::new()
    }
    $expectedAceFlags = 16
    if ($Kind -ceq 'Directory') { $expectedAceFlags = 3 }
    $rules = @()
    foreach ($ace in $raw.DiscretionaryAcl) {
        # Do not let an ACL adapter silently filter unknown, object, callback
        # or conditional ACEs out of the policy snapshot.
        if ($ace -isnot [System.Security.AccessControl.CommonAce] -or
            $ace.AceType -ne [System.Security.AccessControl.AceType]::AccessAllowed -or
            $ace.IsCallback -or [int] $ace.AceFlags -ne $expectedAceFlags -or
            [int] $ace.AccessMask -ne 2032127) {
            throw [System.InvalidOperationException]::new()
        }
        [int] $inheritance = 0
        [int] $propagation = 0
        if (($ace.AceFlags -band [System.Security.AccessControl.AceFlags]::ContainerInherit) -ne 0) {
            $inheritance = $inheritance -bor [int] [System.Security.AccessControl.InheritanceFlags]::ContainerInherit
        }
        if (($ace.AceFlags -band [System.Security.AccessControl.AceFlags]::ObjectInherit) -ne 0) {
            $inheritance = $inheritance -bor [int] [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
        }
        if (($ace.AceFlags -band [System.Security.AccessControl.AceFlags]::NoPropagateInherit) -ne 0) {
            $propagation = $propagation -bor [int] [System.Security.AccessControl.PropagationFlags]::NoPropagateInherit
        }
        if (($ace.AceFlags -band [System.Security.AccessControl.AceFlags]::InheritOnly) -ne 0) {
            $propagation = $propagation -bor [int] [System.Security.AccessControl.PropagationFlags]::InheritOnly
        }
        $rules += [pscustomobject]@{
            Sid = [string] $ace.SecurityIdentifier.Value
            Type = 'Allow'
            Rights = [int] $ace.AccessMask
            IsInherited = [bool] $ace.IsInherited
            InheritanceFlags = $inheritance
            PropagationFlags = $propagation
        }
    }
    # Cross-check the high-level API against *every* raw ACE, never use a
    # potentially filtered GetAccessRules result as the only ACL evidence.
    $adaptedRules = @($security.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
    if ($adaptedRules.Count -ne $raw.DiscretionaryAcl.Count) { throw [System.InvalidOperationException]::new() }
    foreach ($rule in $rules) {
        $matching = 0
        foreach ($adapted in $adaptedRules) {
            if ($adapted.IdentityReference -is [System.Security.Principal.SecurityIdentifier] -and
                $adapted.IdentityReference.Value -ceq $rule.Sid -and
                $adapted.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow -and
                [int] $adapted.FileSystemRights -eq $rule.Rights -and
                [bool] $adapted.IsInherited -eq $rule.IsInherited -and
                [int] $adapted.InheritanceFlags -eq $rule.InheritanceFlags -and
                [int] $adapted.PropagationFlags -eq $rule.PropagationFlags) { $matching++ }
        }
        if ($matching -ne 1) { throw [System.InvalidOperationException]::new() }
    }
    $ownerSid = ''
    if ($null -ne $raw.Owner) { $ownerSid = [string] $raw.Owner.Value }
    return [pscustomobject]@{
        OwnerSid = $ownerSid
        DaclPresent = [bool] ($daclPresent -and $null -ne $raw.DiscretionaryAcl)
        DaclProtected = [bool] $protected
        Canonical = [bool] $security.AreAccessRulesCanonical
        ReparsePoint = [bool] (($attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)
        Rules = [object[]] $rules
    }
}

function New-HkProtectedDirectorySecurity {
    param([string] $CurrentUserSid)
    $security = [System.Security.AccessControl.DirectorySecurity]::new()
    $owner = [System.Security.Principal.SecurityIdentifier]::new($CurrentUserSid)
    $security.SetOwner($owner)
    $security.SetAccessRuleProtection($true, $false)
    $inheritance = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
        [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
    foreach ($sidText in @($CurrentUserSid, 'S-1-5-18')) {
        $sid = [System.Security.Principal.SecurityIdentifier]::new($sidText)
        $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
            $sid, [System.Security.AccessControl.FileSystemRights]::FullControl,
            $inheritance, [System.Security.AccessControl.PropagationFlags]::None,
            [System.Security.AccessControl.AccessControlType]::Allow
        )
        $security.AddAccessRule($rule)
    }
    return $security
}

function Remove-HkKnownEvidence {
    param([string] $RootPath, [string] $SentinelPath, [string] $CurrentUserSid, [bool] $FileWasCreated)
    $cleaned = [pscustomobject]@{ Success = $false; FilesDeleted = 0; DirectoriesDeleted = 0 }
    try {
        if (-not (Test-HkAncestorChain $RootPath)) { return $cleaned }
        $rootSnapshot = Get-HkNativeAclSnapshot $RootPath 'Directory'
        if (-not (EvidenceAcl\Test-HkAclPolicy $rootSnapshot $CurrentUserSid 'Directory').Valid) { return $cleaned }
        $entries = @([System.IO.Directory]::GetFileSystemEntries($RootPath))
        if ($entries.Count -gt 1) { return $cleaned }
        if ($entries.Count -eq 1) {
            if (-not $FileWasCreated -or $entries[0] -cne $SentinelPath) { return $cleaned }
            $fileSnapshot = Get-HkNativeAclSnapshot $SentinelPath 'File'
            if (-not (EvidenceAcl\Test-HkAclPolicy $fileSnapshot $CurrentUserSid 'File').Valid) { return $cleaned }
            if (-not (Test-HkAncestorChain $RootPath)) { return $cleaned }
            [System.IO.File]::Delete($SentinelPath)
            $cleaned.FilesDeleted = 1
        }
        if (-not (Test-HkAncestorChain $RootPath)) { return $cleaned }
        $rootSnapshot = Get-HkNativeAclSnapshot $RootPath 'Directory'
        if (-not (EvidenceAcl\Test-HkAclPolicy $rootSnapshot $CurrentUserSid 'Directory').Valid -or
            @([System.IO.Directory]::GetFileSystemEntries($RootPath)).Count -ne 0) { return $cleaned }
        [System.IO.Directory]::Delete($RootPath, $false)
        $cleaned.DirectoriesDeleted = 1
        if ([System.IO.Directory]::Exists($RootPath) -or [System.IO.File]::Exists($RootPath)) { return $cleaned }
        $cleaned.Success = $true
        return $cleaned
    }
    catch {
        return $cleaned
    }
}

$evidenceRef = 'hk-acl-' + [guid]::NewGuid().ToString('N')
$result = [ordered]@{
    scope = 'synthetic-windows-evidence-permissions-only'
    status = 'BLOCKED'
    code = 'PLATFORM_UNSUPPORTED'
    checks = [ordered]@{
        platformSupported = $false
        identitySupported = $false
        locationSupported = $false
        ancestorsClear = $false
        directoryAclValid = $false
        sentinelContentValid = $false
        fileAclValid = $false
        broadenedAclRejected = $false
        cleanupVerified = $false
    }
    counts = [ordered]@{
        directoriesCreated = 0
        filesCreated = 0
        filesDeleted = 0
        directoriesDeleted = 0
        negativeControls = 0
    }
    evidenceRef = $evidenceRef
}
$exitCode = 2
$rootCreated = $false
$fileCreated = $false
$creationAttempted = $false
$rootPath = $null
$sentinelPath = $null
$currentUserSid = $null
$failureCode = 'PREFLIGHT_FAILED'

try {
    do {
        if (@($args).Count -ne 0) { $result.code = 'ARGUMENTS_UNSUPPORTED'; break }
        if ([System.Environment]::OSVersion.Platform -ne [System.PlatformID]::Win32NT -or
            $PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -lt 1 -or
            $PSVersionTable['PSEdition'] -cne 'Desktop') { break }
        $result.checks.platformSupported = $true
        $modulePath = [System.IO.Path]::Combine($PSScriptRoot, 'EvidenceAcl.psm1')
        Import-Module -Name $modulePath -ErrorAction Stop

        $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
        try { $currentUserSid = [string] $identity.User.Value }
        finally { $identity.Dispose() }
        # Native WindowsIdentity supplies the canonical SID value; this further
        # narrows the supported identities to ordinary local/domain/AzureAD users.
        if (-not [regex]::IsMatch($currentUserSid, '\AS-1-(?:5-21|12-1)-(?:0|[1-9][0-9]{0,9})-(?:0|[1-9][0-9]{0,9})-(?:0|[1-9][0-9]{0,9})-(?:0|[1-9][0-9]{0,9})\z')) {
            $result.code = 'UNSUPPORTED_IDENTITY'; break
        }
        $result.checks.identitySupported = $true
        $basePath = [System.Environment]::GetFolderPath(
            [System.Environment+SpecialFolder]::LocalApplicationData,
            [System.Environment+SpecialFolderOption]::DoNotVerify
        )
        if (-not (Test-HkLocalPathText $basePath)) { $result.code = 'LOCATION_UNSUPPORTED'; break }
        $basePath = [System.IO.Path]::GetFullPath($basePath).TrimEnd('\')
        $drive = [System.IO.DriveInfo]::new([System.IO.Path]::GetPathRoot($basePath))
        if ($drive.DriveType -ne [System.IO.DriveType]::Fixed) { $result.code = 'LOCATION_UNSUPPORTED'; break }
        if (-not $drive.IsReady -or $drive.DriveFormat -cne 'NTFS') { $result.code = 'LOCATION_UNSUPPORTED'; break }
        $result.checks.locationSupported = $true
        if (-not (Test-HkAncestorChain $basePath)) { $result.code = 'ANCESTOR_UNSUPPORTED'; break }
        $result.checks.ancestorsClear = $true
        $createWithAcl = [System.IO.Directory].GetMethod('CreateDirectory', [type[]]@(
            [string], [System.Security.AccessControl.DirectorySecurity]
        ))
        if ($null -eq $createWithAcl) { $result.code = 'CAPABILITY_UNAVAILABLE'; break }

        $rootPath = [System.IO.Path]::Combine($basePath, $evidenceRef)
        $sentinelPath = [System.IO.Path]::Combine($rootPath, 'sentinel.txt')
        if ([System.IO.Directory]::Exists($rootPath) -or [System.IO.File]::Exists($rootPath)) {
            $result.code = 'NAME_COLLISION'; break
        }
        $security = New-HkProtectedDirectorySecurity $currentUserSid
        if (-not (Test-HkAncestorChain $basePath)) { throw [System.InvalidOperationException]::new() }
        $creationAttempted = $true
        # Framework overload applies the protected ACL during creation, before
        # any sentinel exists. It never changes an existing directory's ACL.
        $null = [System.IO.Directory]::CreateDirectory($rootPath, $security)
        $rootCreated = $true
        $result.counts.directoriesCreated = 1
        if (-not (Test-HkAncestorChain $rootPath)) { throw [System.InvalidOperationException]::new() }
        $failureCode = 'ACL_INVALID'
        $directorySnapshot = Get-HkNativeAclSnapshot $rootPath 'Directory'
        if (-not (EvidenceAcl\Test-HkAclPolicy $directorySnapshot $currentUserSid 'Directory').Valid) {
            throw [System.InvalidOperationException]::new()
        }
        $result.checks.directoryAclValid = $true
        if (@([System.IO.Directory]::GetFileSystemEntries($rootPath)).Count -ne 0) {
            throw [System.InvalidOperationException]::new()
        }
        $failureCode = 'PREFLIGHT_FAILED'
        $sentinel = [System.Text.Encoding]::ASCII.GetBytes("SMART-PM synthetic ACL sentinel v1`r`n")
        $stream = [System.IO.FileStream]::new($sentinelPath, [System.IO.FileMode]::CreateNew,
            [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
        $fileCreated = $true
        $result.counts.filesCreated = 1
        try {
            $stream.Write($sentinel, 0, $sentinel.Length)
            $stream.Flush($true)
            $null = $stream.Seek(0, [System.IO.SeekOrigin]::Begin)
            $readBack = New-Object byte[] $sentinel.Length
            $total = 0
            while ($total -lt $readBack.Length) {
                $read = $stream.Read($readBack, $total, $readBack.Length - $total)
                if ($read -eq 0) { break }
                $total += $read
            }
            if ($total -ne $sentinel.Length -or $stream.Length -ne $sentinel.Length) {
                throw [System.InvalidOperationException]::new()
            }
            for ($index = 0; $index -lt $sentinel.Length; $index++) {
                if ($readBack[$index] -ne $sentinel[$index]) { throw [System.InvalidOperationException]::new() }
            }
        }
        finally { $stream.Dispose() }
        $result.checks.sentinelContentValid = $true
        if (-not (Test-HkAncestorChain $rootPath)) { throw [System.InvalidOperationException]::new() }
        $failureCode = 'ACL_INVALID'
        $fileSnapshot = Get-HkNativeAclSnapshot $sentinelPath 'File'
        if (-not (EvidenceAcl\Test-HkAclPolicy $fileSnapshot $currentUserSid 'File').Valid) {
            throw [System.InvalidOperationException]::new()
        }
        $result.checks.fileAclValid = $true
        # Memory-only negative control: the disk DACL is never broadened.
        $negativeRules = @($directorySnapshot.Rules) + @([pscustomobject]@{
            Sid = 'S-1-1-0'; Type = 'Allow'; Rights = 2032127; IsInherited = $false
            InheritanceFlags = 3; PropagationFlags = 0
        })
        $negativeSnapshot = [pscustomobject]@{
            OwnerSid = $directorySnapshot.OwnerSid; DaclPresent = $true; DaclProtected = $true
            Canonical = $true; ReparsePoint = $false; Rules = [object[]] $negativeRules
        }
        $result.counts.negativeControls = 1
        if ((EvidenceAcl\Test-HkAclPolicy $negativeSnapshot $currentUserSid 'Directory').Valid) {
            $failureCode = 'NEGATIVE_CONTROL_FAILED'; throw [System.InvalidOperationException]::new()
        }
        $result.checks.broadenedAclRejected = $true
        $result.status = 'PASS'
        $result.code = 'OK'
        $exitCode = 0
    } while ($false)
}
catch {
    $result.status = 'FAIL'
    $result.code = $failureCode
    $exitCode = 3
}
finally {
    if ($rootCreated) {
        $cleanup = Remove-HkKnownEvidence $rootPath $sentinelPath $currentUserSid $fileCreated
        $result.counts.filesDeleted = $cleanup.FilesDeleted
        $result.counts.directoriesDeleted = $cleanup.DirectoriesDeleted
        $result.checks.cleanupVerified = [bool] $cleanup.Success
        if (-not $cleanup.Success) {
            $result.status = 'FAIL'; $result.code = 'CLEANUP_FAILED'; $exitCode = 3
        }
    }
    elseif ($creationAttempted) {
        # Creation threw before ownership could be established. Never delete an
        # ambiguous candidate, even if the path now happens to exist.
        $result.status = 'FAIL'; $result.code = 'CLEANUP_UNVERIFIED'; $exitCode = 3
    }
}

try { [System.Console]::Out.WriteLine(($result | ConvertTo-Json -Depth 5 -Compress)) }
catch { exit 3 }
exit $exitCode
