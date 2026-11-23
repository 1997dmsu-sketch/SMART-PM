param()

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$VerbosePreference = 'SilentlyContinue'
$DebugPreference = 'SilentlyContinue'
$WarningPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

# This driver invokes only fixed synthetic fixtures. No object is deleted.
# In-memory ACL reference tests, real NTFS observations and fault injection
# remain separate classifications in the output.
$scope = 'synthetic-windows-native-evidence-tests'
$compilerRef = 'hk-win-compile-' + [guid]::NewGuid().ToString('N')
$evidenceRefs = New-Object 'System.Collections.Generic.List[string]'
$caseResults = New-Object 'System.Collections.Generic.List[object]'
$failedIds = New-Object 'System.Collections.Generic.List[string]'
$blockedIds = New-Object 'System.Collections.Generic.List[string]'
$checkNames = @('platformSupported','identitySupported','locationSupported','ancestorHandlesHeld','rootCreatedExclusive','rootAclValid','nativeIdentityValid','rootEntriesValid','filesCreatedExclusive','fileAclsValid','contentVerified','flushVerified','deleteSharingDenied')
$countNames = @('directoriesCreated','filesCreated','bytesWritten','bytesVerified','flushes','validationCalls')
$nativeNames = @('status','code','evidenceRef','compilerRef','checks','counts','newObjectStateUnverified','retained','closed')
$initialization = $null
$referenceJournal = $null
$runtime = [ordered]@{ platform=[Environment]::OSVersion.Platform.ToString(); psVersion=$PSVersionTable.PSVersion.ToString(); psEdition=$PSVersionTable.PSEdition }

function Write-ReferenceJournal([string]$Phase, [string]$CaseId, [object]$EvidenceRef) {
    if ($null -eq $script:referenceJournal) {
        $workspaceParent = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
        $journalPath = [IO.Path]::Combine($workspaceParent, $compilerRef + '.fixtures.jsonl')
        $script:referenceJournal = [IO.File]::Open($journalPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
    }
    $record = [ordered]@{ compilerRef=$compilerRef; evidenceRef=$EvidenceRef; caseId=$CaseId; phase=$Phase; creationConfirmed=$false }
    $bytes = [Text.UTF8Encoding]::new($false).GetBytes(($record | ConvertTo-Json -Compress) + [char]10)
    $script:referenceJournal.Write($bytes,0,$bytes.Length)
    $script:referenceJournal.Flush($true)
}

function Assert-True([bool]$Condition) { if (-not $Condition) { throw 'ASSERTION_FAILED' } }
function Get-SourceByteHash([string]$Path) {
    $hasher = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($hasher.ComputeHash([IO.File]::ReadAllBytes($Path)))).Replace('-','').ToLowerInvariant() }
    finally { $hasher.Dispose() }
}
function Assert-Keys([object]$Value, [string[]]$Expected) {
    Assert-True ($null -ne $Value)
    $actual = @($Value.PSObject.Properties | ForEach-Object { $_.Name })
    Assert-True ($actual.Count -eq $Expected.Count)
    foreach ($name in $Expected) { Assert-True ($actual -ccontains $name) }
}
function Assert-Native([object]$Value) {
    Assert-Keys $Value $nativeNames
    Assert-True (@('PASS','FAIL','BLOCKED') -ccontains [string]$Value.status)
    Assert-True ([string]$Value.code -cmatch '\A[A-Z0-9_]{1,80}\z')
    Assert-True ($Value.retained -is [bool] -and $Value.retained)
    Assert-True ($Value.closed -is [bool])
    Assert-True ($Value.newObjectStateUnverified -is [bool])
    if ($null -ne $Value.evidenceRef) { Assert-True ([string]$Value.evidenceRef -cmatch '\Ahk-win-sink-[0-9a-f]{32}\z') }
    if ($null -ne $Value.compilerRef) { Assert-True ([string]$Value.compilerRef -cmatch '\Ahk-win-compile-[0-9a-f]{32}\z') }
    Assert-Keys $Value.checks $checkNames
    Assert-Keys $Value.counts $countNames
    foreach ($name in $checkNames) { Assert-True ($Value.checks.$name -is [bool]) }
    foreach ($name in $countNames) {
        $number = $Value.counts.$name
        Assert-True (($number -is [int] -or $number -is [long]) -and $number -ge 0)
    }
}
function New-MemoryRule([string]$Sid) {
    return [pscustomobject]@{ Sid=$Sid; Type='Allow'; Rights=[int]2032127; IsInherited=$false; InheritanceFlags=[int]3; PropagationFlags=[int]0 }
}
function New-MemorySnapshot([bool]$ExtraEveryone) {
    # A fixed synthetic SID is used only in this pure reference-policy model.
    $rules = @((New-MemoryRule 'S-1-5-21-101-102-103-1001'),(New-MemoryRule 'S-1-5-18'))
    if ($ExtraEveryone) { $rules += New-MemoryRule 'S-1-1-0' }
    return [pscustomobject]@{ OwnerSid='S-1-5-21-101-102-103-1001'; DaclPresent=$true; DaclProtected=$true; Canonical=$true; ReparsePoint=$false; Rules=[object[]]$rules }
}

$fixtures = @(
    @{ id='NATIVE-01'; fixture='positive'; classification='actual-native'; expected='OK'; directories=1; files=2 },
    @{ id='NATIVE-02'; fixture='collision'; classification='actual-native'; expected='NAME_COLLISION'; directories=1; files=2 },
    @{ id='NATIVE-03'; fixture='delete-access'; classification='actual-native'; expected='DELETE_ACCESS_DENIED'; directories=1; files=0 },
    @{ id='NATIVE-04'; fixture='wrong-id'; classification='actual-native'; expected='FILE_ID_MISMATCH'; directories=1; files=2 },
    @{ id='NATIVE-05'; fixture='root-acl-narrow'; classification='actual-native'; expected='ROOT_ACL_INVALID'; directories=1; files=0 },
    @{ id='NATIVE-06'; fixture='file-acl-narrow'; classification='actual-native'; expected='FILE_ACL_INVALID'; directories=1; files=1 },
    @{ id='NATIVE-07'; fixture='unknown-entry'; classification='actual-native'; expected='UNKNOWN_ENTRY'; directories=1; files=1 },
    @{ id='NATIVE-08'; fixture='reparse'; classification='actual-native'; expected='REPARSE_POINT'; directories=3; files=0 },
    @{ id='NATIVE-09'; fixture='hardlink'; classification='actual-native'; expected='FILE_LINK_COUNT_INVALID'; directories=1; files=2 },
    @{ id='NATIVE-10'; fixture='root-collision'; classification='actual-native'; expected='NAME_COLLISION'; directories=1; files=2 },
    @{ id='FAULT-01'; fixture='partial-write'; classification='fault-injection'; expected='INJECTED_PARTIAL_WRITE'; directories=1; files=1 },
    @{ id='FAULT-02'; fixture='flush-failure'; classification='fault-injection'; expected='INJECTED_FLUSH_FAILURE'; directories=1; files=1 },
    @{ id='FAULT-03'; fixture='read-mismatch'; classification='fault-injection'; expected='INJECTED_READ_MISMATCH'; directories=1; files=1 }
)

$blocked = $false
$dependencyFailed = $false
$planned = 16
$executed = 0
$passed = 0
$notExecuted = 0

foreach ($entry in @(@{id='MEMORY-01';extra=$false;expected=$true},@{id='MEMORY-02';extra=$true;expected=$false})) {
    $executed++
    try {
        Assert-True (@($args).Count -eq 0)
        $modulePath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\hikvision-windows-evidence-preflight\EvidenceAcl.psm1'))
        Assert-True ((Get-SourceByteHash $modulePath) -ceq 'ca1a81bee7cc7f668067a07b956a971740c6ebdfca8c73ca64e9f745ff101bf9')
        Import-Module -Name $modulePath -ErrorAction Stop
        $snapshot = New-MemorySnapshot $entry.extra
        $before = $snapshot | ConvertTo-Json -Depth 8 -Compress
        $policy = EvidenceAcl\Test-HkAclPolicy $snapshot 'S-1-5-21-101-102-103-1001' 'Directory'
        Assert-True ($policy.Valid -is [bool] -and $policy.Valid -eq $entry.expected)
        $expectedCode = 'ACL_INVALID'; if ($entry.expected) { $expectedCode='OK' }
        Assert-True ($policy.Code -ceq $expectedCode)
        Assert-True (($snapshot | ConvertTo-Json -Depth 8 -Compress) -ceq $before)
        $caseResults.Add([ordered]@{id=$entry.id;classification='memory-policy-reference';status='PASS';code='OK';observedCode=$policy.Code})
        $passed++
    } catch {
        $caseResults.Add([ordered]@{id=$entry.id;classification='memory-policy-reference';status='FAIL';code='ASSERTION_FAILED';observedCode=$null})
        $failedIds.Add($entry.id)
        $dependencyFailed=$true
    }
}

if ($dependencyFailed) {
    $caseResults.Add([ordered]@{id='CAPABILITY-01';classification='compiler-capability';status='NOT_EXECUTED';code='DEPENDENCY_FAILED'})
    $notExecuted++
} else {
    $executed++
    try {
        $runtimeSupported = [Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT -and
            $PSVersionTable.PSEdition -ceq 'Desktop' -and $PSVersionTable.PSVersion.Major -eq 5 -and $PSVersionTable.PSVersion.Minor -eq 1
        if (-not $runtimeSupported) {
            $expectedSourceHash = $null
            $initialization = [pscustomobject]@{status='BLOCKED';code='PLATFORM_UNSUPPORTED';compilerRef=$compilerRef;sourceSHA256=$null;assemblySHA256=$null}
        } else {
            $sourcePath = Join-Path $PSScriptRoot 'native\NativeEvidence.cs'
            $expectedSourceHash = Get-SourceByteHash $sourcePath
            Write-ReferenceJournal 'before-compiler-start' 'CAPABILITY-01' $null
            Import-Module -Name (Join-Path $PSScriptRoot 'NativeEvidence.psm1') -ErrorAction Stop
            $initialization = Initialize-HkNativeEvidence -CompilerRef $compilerRef
        }
        Assert-Keys $initialization @('status','code','compilerRef','sourceSHA256','assemblySHA256')
        Assert-True ($initialization.compilerRef -ceq $compilerRef)
        if ($initialization.status -ceq 'BLOCKED') {
            Assert-True ([string]$initialization.code -cmatch '\A[A-Z0-9_]{1,80}\z')
            $blocked=$true; $blockedIds.Add('CAPABILITY-01')
            $caseResults.Add([ordered]@{id='CAPABILITY-01';classification='compiler-capability';status='BLOCKED';code=$initialization.code})
        } else {
            Assert-True ($initialization.status -ceq 'PASS' -and $initialization.code -ceq 'OK')
            Assert-True ($initialization.sourceSHA256 -ceq $expectedSourceHash)
            Assert-True ([string]$initialization.assemblySHA256 -cmatch '\A[0-9a-f]{64}\z')
            $caseResults.Add([ordered]@{id='CAPABILITY-01';classification='compiler-capability';status='PASS';code='OK'})
            $passed++
        }
    } catch {
        $caseResults.Add([ordered]@{id='CAPABILITY-01';classification='compiler-capability';status='FAIL';code='CAPABILITY_ASSERTION_FAILED'})
        $failedIds.Add('CAPABILITY-01'); $dependencyFailed=$true
    }
}

foreach ($entry in $fixtures) {
    if ($blocked -or $dependencyFailed) {
        $notExecuted++
        $reason='DEPENDENCY_FAILED'; if ($blocked) { $reason='DEPENDENCY_BLOCKED' }
        $caseResults.Add([ordered]@{id=$entry.id;fixture=$entry.fixture;classification=$entry.classification;status='NOT_EXECUTED';code=$reason})
        continue
    }
    $executed++
    $reference = 'hk-win-sink-' + [guid]::NewGuid().ToString('N')
    $evidenceRefs.Add($reference)
    $fixture = $null
    try {
        Write-ReferenceJournal 'before-native-create' ([string]$entry.id) $reference
        $raw = [SmartPmEvidence.NativeSession]::TestFixture([string]$entry.fixture,$reference)
        # Serialize only this trusted fixed DTO, not input or exceptions.
        $fixture = $raw | ConvertTo-Json -Depth 12 -Compress | ConvertFrom-Json
        Assert-Keys $fixture @('caseId','classification','status','expectedCode','observedCode','facts','result')
        Assert-True ($fixture.caseId -ceq $entry.fixture -and $fixture.classification -ceq $entry.classification)
        Assert-True ($fixture.expectedCode -ceq $entry.expected)
        Assert-True ([string]$fixture.observedCode -cmatch '\A[A-Z0-9_]{1,80}\z')
        Assert-Native $fixture.result
        Assert-True ($fixture.result.evidenceRef -ceq $reference)
        Assert-True ($fixture.result.closed -and $fixture.result.retained)
        Assert-Keys $fixture.facts @('operationRejected','originalContentUnchanged','identityDifferenceObserved','objectsRetained')
        foreach ($value in $fixture.facts.PSObject.Properties) { Assert-True ($value.Value -is [bool]) }
        Assert-True ($fixture.facts.objectsRetained)
        if ($fixture.status -ceq 'BLOCKED') {
            $blocked=$true; $blockedIds.Add($entry.id)
            $caseResults.Add([ordered]@{id=$entry.id;fixture=$entry.fixture;classification=$entry.classification;status='BLOCKED';code=$fixture.observedCode;native=$fixture.result;facts=$fixture.facts})
            continue
        }
        Assert-True ($fixture.status -ceq 'PASS' -and $fixture.observedCode -ceq $entry.expected)
        Assert-True ($fixture.result.code -ceq $entry.expected)
        Assert-True ($fixture.result.counts.directoriesCreated -eq $entry.directories -and $fixture.result.counts.filesCreated -eq $entry.files)
        if ($entry.fixture -ceq 'positive') {
            Assert-True ($fixture.result.status -ceq 'PASS' -and -not $fixture.result.newObjectStateUnverified)
            foreach ($name in $checkNames) { Assert-True $fixture.result.checks.$name }
            Assert-True ($fixture.result.counts.bytesWritten -gt 0 -and $fixture.result.counts.bytesWritten -eq $fixture.result.counts.bytesVerified)
            Assert-True ($fixture.result.counts.flushes -eq 2 -and $fixture.result.counts.validationCalls -gt 0)
            Assert-True (-not $fixture.facts.operationRejected)
        } else {
            Assert-True ($fixture.result.status -ceq 'FAIL' -and $fixture.result.newObjectStateUnverified -and $fixture.facts.operationRejected)
        }
        if ($entry.fixture -ceq 'collision' -or $entry.fixture -ceq 'root-collision') {
            Assert-True $fixture.facts.originalContentUnchanged
            Assert-True ($fixture.result.counts.bytesWritten -eq $fixture.result.counts.bytesVerified)
        }
        if ($entry.fixture -ceq 'wrong-id') { Assert-True $fixture.facts.identityDifferenceObserved }
        if ($entry.fixture -ceq 'root-acl-narrow') { Assert-True (-not $fixture.result.checks.rootAclValid) }
        if ($entry.fixture -ceq 'file-acl-narrow') { Assert-True (-not $fixture.result.checks.fileAclsValid) }
        if ($entry.fixture -ceq 'unknown-entry') { Assert-True (-not $fixture.result.checks.rootEntriesValid) }
        if ($entry.fixture -ceq 'partial-write') {
            Assert-True ($fixture.result.counts.bytesWritten -eq 7 -and $fixture.result.counts.bytesVerified -eq 0 -and $fixture.result.counts.flushes -eq 0)
        }
        if ($entry.fixture -ceq 'flush-failure') {
            Assert-True ($fixture.result.counts.bytesWritten -gt 0 -and $fixture.result.counts.bytesVerified -eq 0 -and $fixture.result.counts.flushes -eq 0)
        }
        if ($entry.fixture -ceq 'read-mismatch') {
            Assert-True ($fixture.result.counts.bytesWritten -gt 0 -and $fixture.result.counts.bytesVerified -eq 0 -and $fixture.result.counts.flushes -eq 1)
        }
        $caseResults.Add([ordered]@{id=$entry.id;fixture=$entry.fixture;classification=$entry.classification;status='PASS';code='OK';expectedCode=$entry.expected;observedCode=$fixture.observedCode;native=$fixture.result;facts=$fixture.facts})
        $passed++
    } catch {
        $native=$null; if ($null -ne $fixture) { $native=$fixture.result }
        $caseResults.Add([ordered]@{id=$entry.id;fixture=$entry.fixture;classification=$entry.classification;status='FAIL';code='ASSERTION_FAILED';native=$native})
        $failedIds.Add($entry.id)
        $dependencyFailed=$true
    }
}

$status='PASS'; $exitCode=0
if ($failedIds.Count -ne 0) { $status='FAIL';$exitCode=1 }
elseif ($blockedIds.Count -ne 0) { $status='BLOCKED';$exitCode=2 }
$output=[ordered]@{
    scope=$scope;status=$status;runtime=$runtime
    counts=[ordered]@{planned=$planned;executed=$executed;passed=$passed;failed=$failedIds.Count;blocked=$blockedIds.Count;notExecuted=$notExecuted}
    failedCaseIds=@($failedIds.ToArray());blockedCaseIds=@($blockedIds.ToArray());caseResults=@($caseResults.ToArray())
    evidenceRefs=@($evidenceRefs.ToArray());compilerRefs=@($compilerRef);compiler=$initialization;cleanup='NOT_EXECUTED'
}
if ($null -ne $referenceJournal) { $referenceJournal.Dispose() }
[Console]::Out.WriteLine(($output | ConvertTo-Json -Depth 16 -Compress))
exit $exitCode
