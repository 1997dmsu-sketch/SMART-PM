param([Parameter(Mandatory=$true)][string]$EvidenceRef,[Parameter(Mandatory=$true)][string]$CompilerRef)
Set-StrictMode -Version 2.0
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$VerbosePreference='SilentlyContinue'
$DebugPreference='SilentlyContinue'
$WarningPreference='SilentlyContinue'
[Console]::InputEncoding=[Text.UTF8Encoding]::new($false,$true)
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$script:session=$null
$script:last=$null
$script:initialized=$false
$script:inputOverflow=$false
$checkNames=@('platformSupported','identitySupported','locationSupported','ancestorHandlesHeld','rootCreatedExclusive','rootAclValid','nativeIdentityValid','rootEntriesValid','filesCreatedExclusive','fileAclsValid','contentVerified','flushVerified','deleteSharingDenied')
$countNames=@('directoriesCreated','filesCreated','bytesWritten','bytesVerified','flushes','validationCalls')

function New-SafeNativeResult([string]$Status,[string]$Code,[bool]$Closed=$false) {
    $checks=[ordered]@{};foreach($name in $checkNames){$checks[$name]=$false}
    $counts=[ordered]@{};foreach($name in $countNames){$counts[$name]=0}
    return [pscustomobject][ordered]@{status=$Status;code=$Code;evidenceRef=$EvidenceRef;compilerRef=$CompilerRef;checks=$checks;counts=$counts;newObjectStateUnverified=$false;retained=$true;closed=$Closed}
}
function Test-Record($Value,[string[]]$Names) {
    if($null -eq $Value -or $Value -isnot [System.Management.Automation.PSCustomObject]){return $false}
    $properties=@($Value.PSObject.Properties)
    if($properties.Count -ne $Names.Count){return $false}
    foreach($property in $properties){if($property.MemberType -ne [Management.Automation.PSMemberTypes]::NoteProperty -or $Names -cnotcontains $property.Name){return $false}}
    return $true
}
function Test-Integer($Value,[long]$Maximum) {
    return (($Value -is [int] -or $Value -is [long]) -and $Value -ge 0 -and $Value -le $Maximum)
}
function Test-Summary($Value) {
    if(-not (Test-Record $Value @('schemaVersion','phase','status','code','counts','stages','allowReadStayedFalse'))){return $false}
    if($Value.schemaVersion -cne 'hk-ai-08-offline-summary-v1' -or $Value.phase -cne 'synthetic-offline-only' -or
        @('PASS','FAIL') -cnotcontains $Value.status -or $Value.code -isnot [string] -or $Value.code -cnotmatch '\A[A-Z][A-Z0-9_]{0,63}\z' -or
        (($Value.status -ceq 'PASS') -ne ($Value.code -ceq 'OK')) -or $Value.allowReadStayedFalse -isnot [bool] -or -not $Value.allowReadStayedFalse){return $false}
    if(-not (Test-Record $Value.counts @('logicalEndpoints','transmissions','authRetries','unknownEndpoints'))){return $false}
    if(-not (Test-Integer $Value.counts.logicalEndpoints 6) -or -not (Test-Integer $Value.counts.transmissions 12) -or
        -not (Test-Integer $Value.counts.authRetries 6) -or -not (Test-Integer $Value.counts.unknownEndpoints 6)){return $false}
    if($Value.stages -isnot [object[]] -or $Value.stages.Count -ne 6){return $false}
    $ids=@('deviceInfo','acsCapabilities','userInfoCapabilities','fdlibCapabilities','fdlibList','fdlibCount')
    $transmissions=0;$logical=0;$retries=0;$unknown=0
    for($index=0;$index -lt 6;$index++){
        $stage=$Value.stages[$index]
        if(-not (Test-Record $stage @('id','state','code','httpStatus','transmissions'))){return $false}
        if($stage.id -cne $ids[$index] -or @('NOT_EXECUTED','confirmed','unsupported','unknown','blocked') -cnotcontains $stage.state -or
            $stage.code -isnot [string] -or $stage.code -cnotmatch '\A[A-Z][A-Z0-9_]{0,63}\z' -or -not (Test-Integer $stage.transmissions 2)){return $false}
        if($null -ne $stage.httpStatus -and (-not (Test-Integer $stage.httpStatus 599) -or $stage.httpStatus -lt 100)){return $false}
        if($stage.state -ceq 'NOT_EXECUTED' -and ($stage.code -cne 'NOT_EXECUTED' -or $null -ne $stage.httpStatus -or $stage.transmissions -ne 0)){return $false}
        $transmissions+=$stage.transmissions
        if($stage.transmissions -gt 0){$logical++;$retries+=$stage.transmissions-1}
        if($stage.state -ceq 'unknown'){$unknown++}
    }
    return ($Value.counts.transmissions -eq $transmissions -and $Value.counts.logicalEndpoints -eq $logical -and $Value.counts.authRetries -eq $retries -and $Value.counts.unknownEndpoints -eq $unknown)
}
function Read-BoundedLine {
    $buffer=[Text.StringBuilder]::new()
    for($index=0;$index -lt 131073;$index++){
        $next=[Console]::In.Read()
        if($next -lt 0){if($buffer.Length -eq 0){return $null};return $buffer.ToString()}
        if($next -eq 10){return $buffer.ToString().TrimEnd([char]13)}
        [void]$buffer.Append([char]$next)
    }
    $script:inputOverflow=$true
    return $null
}
function Send-Reply([int]$Id,$Native) {
    $Native.compilerRef=$CompilerRef
    $script:last=$Native
    [Console]::Out.WriteLine((ConvertTo-Json -InputObject ([ordered]@{id=$Id;native=$Native}) -Depth 12 -Compress))
    [Console]::Out.Flush()
}

try {
    if($EvidenceRef -cnotmatch '\Ahk-win-sink-[0-9a-f]{32}\z' -or $CompilerRef -cnotmatch '\Ahk-win-compile-[0-9a-f]{32}\z'){exit 2}
    Import-Module -Name (Join-Path $PSScriptRoot 'NativeEvidence.psm1') -ErrorAction Stop
    for($requestCount=0;$requestCount -lt 256;$requestCount++){
        $line=Read-BoundedLine
        if($null -eq $line){break}
        $request=$line|ConvertFrom-Json -ErrorAction Stop
        if(-not (Test-Record $request @('id','op')) -and -not (Test-Record $request @('id','op','summary'))){throw 'PROTOCOL_INVALID'}
        if(-not (Test-Integer $request.id 1000000) -or $request.id -lt 1 -or $request.op -isnot [string]){throw 'PROTOCOL_INVALID'}
        $id=[int]$request.id
        if(-not $script:initialized){
            if($request.op -cne 'init' -or -not (Test-Record $request @('id','op'))){throw 'PROTOCOL_INVALID'}
            $script:initialized=$true
            $compiled=Initialize-HkNativeEvidence -CompilerRef $CompilerRef
            if($compiled.status -cne 'PASS') {Send-Reply $id (New-SafeNativeResult 'BLOCKED' $compiled.code);continue}
            $script:session=[SmartPmEvidence.NativeSession]::Create($EvidenceRef)
            Send-Reply $id ($script:session.Observe())
            continue
        }
        if($request.op -ceq 'close' -and (Test-Record $request @('id','op'))){
            if($null -ne $script:session){Send-Reply $id ($script:session.Close())}
            elseif($null -ne $script:last){$script:last.closed=$true;Send-Reply $id $script:last}
            else{Send-Reply $id (New-SafeNativeResult 'FAIL' 'NATIVE_CAPABILITY_UNAVAILABLE' $true)}
            break
        }
        if($null -eq $script:session){Send-Reply $id (New-SafeNativeResult 'BLOCKED' 'NATIVE_CAPABILITY_UNAVAILABLE');continue}
        if($request.op -ceq 'validate' -and (Test-Record $request @('id','op'))){Send-Reply $id ($script:session.Validate());continue}
        if($request.op -ceq 'write' -and (Test-Record $request @('id','op','summary')) -and (Test-Summary $request.summary)){
            $summaryJson=ConvertTo-Json -InputObject $request.summary -Depth 10 -Compress
            Send-Reply $id ($script:session.WriteSynthetic($summaryJson));continue
        }
        throw 'PROTOCOL_INVALID'
    }
    if($script:inputOverflow){exit 2}
} catch {
    # Do not format exception values: native paths, account names and identities
    # are never emitted. Node retains pre-launch references on protocol loss.
    exit 2
} finally {
    if($null -ne $script:session){$null=$script:session.Close()}
}
