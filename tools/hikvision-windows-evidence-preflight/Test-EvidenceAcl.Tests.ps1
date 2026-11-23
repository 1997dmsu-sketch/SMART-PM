# Pester-free, synthetic-only policy tests. Preparation environment has no
# PowerShell runtime: this file has NOT been parsed or executed there.
# Never invokes Test-EvidenceAcl.ps1, WindowsIdentity, ACL APIs or external tools.
$ErrorActionPreference = 'Stop'
trap {
    # Setup/runtime faults are sanitized too; never format the error record.
    [pscustomobject][ordered]@{
        scope = 'synthetic-acl-policy-tests-only'
        status = 'FAIL'
        counts = [pscustomobject]@{ total = 1; passed = 0; failed = 1 }
        failedCaseIds = [string[]]@('HARNESS_INTERNAL')
    } | ConvertTo-Json -Depth 4 -Compress
    exit 1
}
$SyntheticUserSid = 'S-1-5-21-100-200-300-1001'
$SyntheticOtherSid = 'S-1-5-21-100-200-300-1002'
$Cases = New-Object 'System.Collections.Generic.List[object]'
$FailedCaseIds = New-Object 'System.Collections.Generic.List[string]'
$GetterProbe = [pscustomobject]@{ Calls = 0 }

function New-SyntheticRule {
    param([string]$Sid, [bool]$Inherited, [int]$Inheritance)
    return [pscustomobject][ordered]@{
        Sid = $Sid
        Type = 'Allow'
        Rights = [int]2032127
        IsInherited = $Inherited
        InheritanceFlags = $Inheritance
        PropagationFlags = [int]0
    }
}

function New-SyntheticSnapshot {
    param([string]$Kind)
    $File = $Kind -ceq 'File'
    $Inheritance = if ($File) { 0 } else { 3 }
    return [pscustomobject][ordered]@{
        OwnerSid = $SyntheticUserSid
        DaclPresent = $true
        DaclProtected = (-not $File)
        Canonical = $true
        ReparsePoint = $false
        Rules = [object[]]@(
            (New-SyntheticRule $SyntheticUserSid $File $Inheritance)
            (New-SyntheticRule 'S-1-5-18' $File $Inheritance)
        )
    }
}

# Build an inert descriptor tree before JSON serialization. Only NoteProperty
# values are read. ScriptProperty getters/setters are recorded, never invoked.
function Get-SafeSnapshotNode {
    param([AllowNull()][object]$Value)
    if ($null -eq $Value) { return [pscustomobject]@{ Type = 'null' } }
    if ($Value -is [array]) {
        $Items = @()
        foreach ($Item in $Value) { $Items += ,(Get-SafeSnapshotNode $Item) }
        return [pscustomobject]@{ Type = $Value.GetType().FullName; Items = $Items }
    }
    if ($Value -is [pscustomobject]) {
        $Properties = @()
        foreach ($Property in $Value.PSObject.Properties) {
            $Descriptor = [ordered]@{
                Name = $Property.Name
                MemberType = $Property.MemberType.ToString()
                IsGettable = $Property.IsGettable
                IsSettable = $Property.IsSettable
            }
            if ($Property.MemberType -eq [System.Management.Automation.PSMemberTypes]::NoteProperty) {
                $Descriptor.Value = Get-SafeSnapshotNode $Property.Value
            } elseif ($Property.MemberType -eq [System.Management.Automation.PSMemberTypes]::ScriptProperty) {
                $Descriptor.Getter = if ($null -eq $Property.GetterScript) { $null } else { $Property.GetterScript.ToString() }
                $Descriptor.Setter = if ($null -eq $Property.SetterScript) { $null } else { $Property.SetterScript.ToString() }
                $Descriptor.GetterIdentity = if ($null -eq $Property.GetterScript) { 0 } else { [System.Runtime.CompilerServices.RuntimeHelpers]::GetHashCode($Property.GetterScript) }
                $Descriptor.SetterIdentity = if ($null -eq $Property.SetterScript) { 0 } else { [System.Runtime.CompilerServices.RuntimeHelpers]::GetHashCode($Property.SetterScript) }
            } else {
                # No adapted value evaluation for unexpected member kinds.
                $Descriptor.Unread = $true
            }
            $Properties += ,([pscustomobject]$Descriptor)
        }
        return [pscustomobject]@{ Type = $Value.GetType().FullName; Properties = $Properties }
    }
    return [pscustomobject]@{ Type = $Value.GetType().FullName; Value = $Value }
}

function Get-SafeSnapshot {
    param([AllowNull()][object]$Value)
    return (Get-SafeSnapshotNode $Value | ConvertTo-Json -Depth 100 -Compress)
}

function Add-SyntheticCase {
    param(
        [string]$Id,
        [string]$Kind,
        [bool]$ExpectedValid,
        [scriptblock]$Mutate,
        [string]$UserSid = $SyntheticUserSid
    )
    $Snapshot = New-SyntheticSnapshot $Kind
    # Keep owner/rule aligned with the requested synthetic user so SID-negative
    # cases cannot pass merely because owner equality failed first.
    $Snapshot.OwnerSid = $UserSid
    $Snapshot.Rules[0].Sid = $UserSid
    if ($null -ne $Mutate) { $null = & $Mutate $Snapshot }
    $Cases.Add([pscustomobject]@{
        Id = $Id; Kind = $Kind; ExpectedValid = $ExpectedValid
        Snapshot = $Snapshot; CurrentUserSid = $UserSid
    })
}

# Expectations below come from the frozen policy, not from production helpers.
# Every ID has a fresh fixture and its own complete before/after snapshot.
Add-SyntheticCase 'ACL-01' 'Directory' $true $null
Add-SyntheticCase 'ACL-02' 'File' $true $null
Add-SyntheticCase 'ACL-03' 'Directory' $true { param($s) $s.Rules = [object[]]@($s.Rules[1], $s.Rules[0]) }
Add-SyntheticCase 'ACL-04' 'File' $true { param($s) $s.Rules = [object[]]@($s.Rules[1], $s.Rules[0]) }
Add-SyntheticCase 'ACL-05' 'Directory' $false $null
$Cases[$Cases.Count - 1].Snapshot = $null
Add-SyntheticCase 'ACL-06' 'Directory' $false { param($s) Add-Member -InputObject $s -NotePropertyName Extra -NotePropertyValue 'synthetic-only' }
Add-SyntheticCase 'ACL-07' 'Directory' $false { param($s) $s.PSObject.Properties.Remove('OwnerSid') }
$Probe = $GetterProbe
$Getter = { $Probe.Calls += 1; return 'SYNTHETIC_GETTER_SENTINEL' }.GetNewClosure()
Add-SyntheticCase 'ACL-08' 'Directory' $false {
    param($s)
    $s.PSObject.Properties.Remove('OwnerSid')
    Add-Member -InputObject $s -MemberType ScriptProperty -Name OwnerSid -Value $Getter
}
Add-SyntheticCase 'ACL-09' 'Directory' $false { param($s) $s.Rules = $null }
Add-SyntheticCase 'ACL-10' 'Directory' $false { param($s) $s.Rules = $s.Rules[0] }
Add-SyntheticCase 'ACL-11' 'Directory' $false { param($s) Add-Member -InputObject $s.Rules[0] -NotePropertyName Extra -NotePropertyValue 'synthetic-only' }
Add-SyntheticCase 'ACL-12' 'Directory' $false { param($s) $s.Rules[0].PSObject.Properties.Remove('Rights') }
Add-SyntheticCase 'ACL-13' 'Directory' $false {
    param($s)
    $s.Rules[0].PSObject.Properties.Remove('Rights')
    Add-Member -InputObject $s.Rules[0] -MemberType ScriptProperty -Name Rights -Value $Getter
}
Add-SyntheticCase 'ACL-14' 'Directory' $false { param($s) $s.OwnerSid = $SyntheticOtherSid }
Add-SyntheticCase 'ACL-15' 'Directory' $false { param($s) $s.DaclPresent = $false }
Add-SyntheticCase 'ACL-16' 'Directory' $false { param($s) $s.DaclProtected = $false }
Add-SyntheticCase 'ACL-17' 'File' $false { param($s) $s.DaclProtected = $true }
Add-SyntheticCase 'ACL-18' 'Directory' $false { param($s) $s.Canonical = $false }
Add-SyntheticCase 'ACL-19' 'Directory' $false { param($s) $s.ReparsePoint = $true }
Add-SyntheticCase 'ACL-20' 'Directory' $false { param($s) $s.Canonical = 'true' }
Add-SyntheticCase 'ACL-21' 'Directory' $false { param($s) $s.Rules = [object[]]@($s.Rules[0]) }
Add-SyntheticCase 'ACL-22' 'Directory' $false { param($s) $s.Rules = [object[]]@() }
Add-SyntheticCase 'ACL-23' 'Directory' $false { param($s) $s.Rules = [object[]]@($s.Rules[0], (New-SyntheticRule $SyntheticUserSid $false 3)) }
Add-SyntheticCase 'ACL-24' 'Directory' $false { param($s) $s.Rules[1].Sid = $SyntheticOtherSid }
Add-SyntheticCase 'ACL-25' 'Directory' $false { param($s) $s.Rules[1].Sid = 'S-1-1-0' }
Add-SyntheticCase 'ACL-26' 'Directory' $false { param($s) $s.Rules[1].Type = 'Deny' }
Add-SyntheticCase 'ACL-27' 'Directory' $false {
    param($s)
    $Deny = New-SyntheticRule 'S-1-1-0' $false 3
    $Deny.Type = 'Deny'
    $s.Rules = [object[]]@($s.Rules[0], $s.Rules[1], $Deny)
}
Add-SyntheticCase 'ACL-28' 'Directory' $false { param($s) $s.Rules[0].Rights = [int]2032126 }
Add-SyntheticCase 'ACL-29' 'Directory' $false { param($s) $s.Rules[0].Rights = '2032127' }
Add-SyntheticCase 'ACL-30' 'Directory' $false { param($s) $s.Rules[0].Rights = [double]2032127 }
Add-SyntheticCase 'ACL-31' 'Directory' $false { param($s) $s.Rules[0].IsInherited = $true }
Add-SyntheticCase 'ACL-32' 'File' $false { param($s) $s.Rules[0].IsInherited = $false }
Add-SyntheticCase 'ACL-33' 'Directory' $false { param($s) $s.Rules[0].InheritanceFlags = [int]0 }
Add-SyntheticCase 'ACL-34' 'File' $false { param($s) $s.Rules[0].InheritanceFlags = [int]3 }
Add-SyntheticCase 'ACL-35' 'Directory' $false { param($s) $s.Rules[0].PropagationFlags = [int]1 }
Add-SyntheticCase 'ACL-36' 'Directory' $false { param($s) $s.Rules[0].IsInherited = 'false' }
Add-SyntheticCase 'ACL-37' 'Directory' $false $null 'S-1-5-18'
Add-SyntheticCase 'ACL-38' 'Directory' $false $null 'SYNTHETIC_NOT_A_SID'
Add-SyntheticCase 'ACL-39' 'Directory' $false { param($s) $s.OwnerSid = $null }
Add-SyntheticCase 'ACL-40' 'Directory' $false { param($s) $s.Rules = [object[]]@($s.Rules[0], $null) }
Add-SyntheticCase 'ACL-41' 'Directory' $true $null 'S-1-12-1-10-20-30-40'
Add-SyntheticCase 'ACL-42' 'File' $true $null 'S-1-5-21-100-200-300-500'
Add-SyntheticCase 'ACL-43' 'Directory' $true $null 'S-1-5-21-0-4294967295-0-500'
Add-SyntheticCase 'ACL-44' 'Directory' $false $null 'S-1-5-32-544'
Add-SyntheticCase 'ACL-45' 'Directory' $false $null 'S-1-5-19'
Add-SyntheticCase 'ACL-46' 'Directory' $false $null 'S-1-5-21-0100-200-300-1001'
Add-SyntheticCase 'ACL-47' 'Directory' $false $null 'S-1-5-21-100-200-300-4294967296'
Add-SyntheticCase 'ACL-48' 'Directory' $false $null 'S-1-12-1-10-20-30'
Add-SyntheticCase 'ACL-49' 'Directory' $false $null 'S-1-1-0'
Add-SyntheticCase 'ACL-50' 'Directory' $true {
    param($s)
    foreach ($Rule in $s.Rules) {
        $Rule.Rights = [long]2032127
        $Rule.InheritanceFlags = [uint32]3
        $Rule.PropagationFlags = [int16]0
    }
}
Add-SyntheticCase 'ACL-51' 'Directory' $false $null ("S-1-5-21-100-200-300-1001`n")

$BootstrapFailed = $false
try {
    # The actual sibling production module is imported. No copied validator or
    # mocked command substitutes for its exported Test-HkAclPolicy function.
    $ModulePath = Join-Path $PSScriptRoot 'EvidenceAcl.psm1'
    $Imported = @(Import-Module -Name $ModulePath -Force -PassThru -ErrorAction Stop *>&1)
    if ($Imported.Count -ne 1 -or $Imported[0] -isnot [System.Management.Automation.PSModuleInfo]) { throw 'BOOTSTRAP' }
    $Exports = $Imported[0].ExportedCommands
    if ($Exports.Count -ne 1 -or @($Exports.Keys)[0] -cne 'Test-HkAclPolicy') { throw 'BOOTSTRAP' }
    $PolicyCommand = $Exports['Test-HkAclPolicy']
    if ($PolicyCommand -isnot [System.Management.Automation.FunctionInfo]) { throw 'BOOTSTRAP' }
    $PathComparer = [System.StringComparer]::Ordinal
    if ([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT) {
        $PathComparer = [System.StringComparer]::OrdinalIgnoreCase
    }
    if (-not $PathComparer.Equals([IO.Path]::GetFullPath($PolicyCommand.Module.Path), [IO.Path]::GetFullPath($ModulePath))) { throw 'BOOTSTRAP' }
} catch {
    $BootstrapFailed = $true
    $FailedCaseIds.Add('BOOTSTRAP')
}

if (-not $BootstrapFailed) {
    foreach ($Case in $Cases) {
        $Failed = $false
        try {
            $Before = Get-SafeSnapshot $Case.Snapshot
            $GetterCallsBefore = $GetterProbe.Calls
            # Capture all streams: an echoed input/error/warning is a test
            # failure, not additional test stdout or a leaked diagnostic.
            $Results = @(& $PolicyCommand -Snapshot $Case.Snapshot -CurrentUserSid $Case.CurrentUserSid -Kind $Case.Kind *>&1)
            $After = Get-SafeSnapshot $Case.Snapshot
            if ($Before -cne $After -or $GetterProbe.Calls -ne $GetterCallsBefore -or $GetterProbe.Calls -ne 0) { throw 'CASE' }
            if ($Results.Count -ne 1 -or $Results[0] -isnot [pscustomobject]) { throw 'CASE' }
            $Result = $Results[0]
            $Properties = @($Result.PSObject.Properties)
            if ($Properties.Count -ne 2) { throw 'CASE' }
            foreach ($Property in $Properties) {
                if ($Property.MemberType -ne [System.Management.Automation.PSMemberTypes]::NoteProperty) { throw 'CASE' }
                if ($Property.Name -cne 'Valid' -and $Property.Name -cne 'Code') { throw 'CASE' }
            }
            if ($Result.Valid -isnot [bool] -or $Result.Code -isnot [string]) { throw 'CASE' }
            $ExpectedCode = if ($Case.ExpectedValid) { 'OK' } else { 'ACL_INVALID' }
            if ($Result.Valid -ne $Case.ExpectedValid -or $Result.Code -cne $ExpectedCode) { throw 'CASE' }
        } catch {
            $Failed = $true
            # Still take the independent post-error snapshot when possible.
            # Do not format or emit the caught exception, input or stack.
            try {
                $After = Get-SafeSnapshot $Case.Snapshot
                if ($Before -cne $After -or $GetterProbe.Calls -ne 0) { $Failed = $true }
            } catch { $Failed = $true }
        }
        if ($Failed) { $FailedCaseIds.Add($Case.Id) }
    }
}

$Total = if ($BootstrapFailed) { 1 } else { $Cases.Count }
$FailureCount = $FailedCaseIds.Count
$Summary = [pscustomobject][ordered]@{
    scope = 'synthetic-acl-policy-tests-only'
    status = $(if ($FailureCount -eq 0) { 'PASS' } else { 'FAIL' })
    counts = [pscustomobject][ordered]@{ total = $Total; passed = ($Total - $FailureCount); failed = $FailureCount }
    failedCaseIds = [string[]]($FailedCaseIds.ToArray())
}
$Summary | ConvertTo-Json -Depth 4 -Compress
if ($FailureCount -ne 0) { exit 1 }
exit 0
