# Pester-free, memory-only regression for the production native ACL projection.
# Never runs the main script, its path/ACL-reading prefix, or its cleanup code.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
trap {
    [pscustomobject][ordered]@{
        scope = 'memory-only-native-acl-projection-tests'
        status = 'FAIL'
        counts = [pscustomobject]@{ total = 1; passed = 0; failed = 1 }
        failedCaseIds = [string[]]@('HARNESS_INTERNAL')
    } | ConvertTo-Json -Depth 4 -Compress
    exit 1
}

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT -or
    $PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1 -or
    $PSVersionTable.PSEdition -cne 'Desktop') { throw 'RUNTIME_UNSUPPORTED' }

# Parse, do not dot-source: exclude all main-script top-level execution and the
# filesystem prefix. The extracted suffix operates only on a supplied in-memory
# security descriptor and attributes; all executable method calls are checked.
$SourcePath = Join-Path $PSScriptRoot 'Test-EvidenceAcl.ps1'
$Tokens = $null
$ParseErrors = $null
$Tree = [System.Management.Automation.Language.Parser]::ParseFile($SourcePath, [ref]$Tokens, [ref]$ParseErrors)
if (@($ParseErrors).Count -ne 0) { throw 'SOURCE_PARSE_FAILED' }
$Functions = @($Tree.FindAll({
    param($Node)
    $Node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
        $Node.Name -ceq 'Get-HkNativeAclSnapshot'
}, $false))
if ($Functions.Count -ne 1) { throw 'PROJECTION_FUNCTION_MISSING' }
$Statements = @($Functions[0].Body.EndBlock.Statements)
$Starts = @($Statements | Where-Object {
    $_ -is [System.Management.Automation.Language.AssignmentStatementAst] -and
    $_.Left -is [System.Management.Automation.Language.VariableExpressionAst] -and
    $_.Left.VariablePath.UserPath -ceq 'binary'
})
if ($Starts.Count -ne 1 -or
    $Starts[0].Extent.Text -cne '$binary = $security.GetSecurityDescriptorBinaryForm()' -or
    $Statements[-1] -isnot [System.Management.Automation.Language.ReturnStatementAst]) {
    throw 'PROJECTION_BOUNDARY_CHANGED'
}
$Source = [IO.File]::ReadAllText($SourcePath)
$StartOffset = $Starts[0].Extent.StartOffset
$EndOffset = $Statements[-1].Extent.EndOffset
$Suffix = $Source.Substring($StartOffset, $EndOffset - $StartOffset)
$Projection = [scriptblock]::Create('param($security, $Kind, $attributes)' + [Environment]::NewLine + $Suffix)
if (@($Projection.Ast.FindAll({
    param($Node)
    $Node -is [System.Management.Automation.Language.CommandAst]
}, $true)).Count -ne 0) { throw 'PROJECTION_COMMAND_FORBIDDEN' }
$Calls = @($Projection.Ast.FindAll({
    param($Node)
    $Node -is [System.Management.Automation.Language.InvokeMemberExpressionAst]
}, $true))
foreach ($Call in $Calls) {
    if ($Call.Member -isnot [System.Management.Automation.Language.StringConstantExpressionAst]) {
        throw 'DYNAMIC_MEMBER_FORBIDDEN'
    }
    $Allowed = $false
    $ArgumentCount = 0
    if ($null -ne $Call.Arguments) { $ArgumentCount = $Call.Arguments.Count }
    if (-not $Call.Static -and
        $Call.Expression -is [System.Management.Automation.Language.VariableExpressionAst] -and
        $Call.Expression.VariablePath.UserPath -ceq 'security') {
        $Allowed = ($Call.Member.Value -ceq 'GetSecurityDescriptorBinaryForm' -and $ArgumentCount -eq 0) -or
            ($Call.Member.Value -ceq 'GetAccessRules' -and $ArgumentCount -eq 3)
    }
    elseif ($Call.Static -and
        $Call.Expression -is [System.Management.Automation.Language.TypeExpressionAst] -and
        $Call.Member.Value -ceq 'new') {
        $TypeName = $Call.Expression.TypeName.FullName
        $Allowed = ($TypeName -ceq 'System.Security.AccessControl.RawSecurityDescriptor' -and $ArgumentCount -eq 2) -or
            ($TypeName -ceq 'System.InvalidOperationException' -and $ArgumentCount -eq 0)
    }
    if (-not $Allowed) { throw 'PROJECTION_METHOD_FORBIDDEN' }
}

Import-Module (Join-Path $PSScriptRoot 'EvidenceAcl.psm1') -ErrorAction Stop
$SyntheticUser = 'S-1-5-21-111111111-222222222-333333333-1001'
$DirectoryAllow = '(A;OICI;FA;;;' + $SyntheticUser + ')(A;OICI;FA;;;SY)'
$FileAllow = '(A;ID;FA;;;' + $SyntheticUser + ')(A;ID;FA;;;SY)'
$Owner = 'O:' + $SyntheticUser
$Cases = @(
    @{ Id = 'NATIVE-01'; Kind = 'Directory'; Sddl = $Owner + 'D:P' + $DirectoryAllow; Projected = $true; Valid = $true }
    @{ Id = 'NATIVE-02'; Kind = 'File'; Sddl = $Owner + 'D:' + $FileAllow; Projected = $true; Valid = $true }
    @{ Id = 'NATIVE-03'; Kind = 'Directory'; Sddl = $Owner + 'D:P' + $DirectoryAllow + '(A;OICI;FA;;;WD)'; Projected = $false; Valid = $false }
    @{ Id = 'NATIVE-04'; Kind = 'Directory'; Sddl = $Owner + 'D:P(D;OICI;FA;;;WD)(A;OICI;FA;;;' + $SyntheticUser + ')'; Projected = $false; Valid = $false }
    @{ Id = 'NATIVE-05'; Kind = 'Directory'; Sddl = $Owner + 'D:P(A;OICINP;FA;;;' + $SyntheticUser + ')(A;OICI;FA;;;SY)'; Projected = $false; Valid = $false }
    @{ Id = 'NATIVE-06'; Kind = 'File'; Sddl = $Owner + 'D:(A;;FA;;;' + $SyntheticUser + ')(A;ID;FA;;;SY)'; Projected = $false; Valid = $false }
    @{ Id = 'NATIVE-07'; Kind = 'Directory'; Sddl = $Owner + 'D:P(A;OICI;0x001f01fe;;;' + $SyntheticUser + ')(A;OICI;FA;;;SY)'; Projected = $false; Valid = $false }
    @{ Id = 'NATIVE-08'; Kind = 'Directory'; Sddl = 'O:SYD:P' + $DirectoryAllow; Projected = $true; Valid = $false }
    @{ Id = 'NATIVE-09'; Kind = 'Directory'; Sddl = $Owner + 'D:' + $DirectoryAllow; Projected = $true; Valid = $false }
    @{ Id = 'NATIVE-10'; Kind = 'File'; Sddl = $Owner + 'D:P' + $FileAllow; Projected = $true; Valid = $false }
    @{ Id = 'NATIVE-11'; Kind = 'Directory'; Sddl = $Owner + 'D:P'; Projected = $false; Valid = $false }
    @{ Id = 'NATIVE-12'; Kind = 'Directory'; Sddl = $Owner + 'D:P(A;OICI;FA;;;' + $SyntheticUser + ')'; Projected = $false; Valid = $false }
)
$FailedIds = New-Object 'System.Collections.Generic.List[string]'
foreach ($Case in $Cases) {
    $Security = if ($Case.Kind -ceq 'Directory') {
        [System.Security.AccessControl.DirectorySecurity]::new()
    } else {
        [System.Security.AccessControl.FileSecurity]::new()
    }
    $Security.SetSecurityDescriptorSddlForm($Case.Sddl)
    $Before = [Convert]::ToBase64String($Security.GetSecurityDescriptorBinaryForm())
    $Attributes = if ($Case.Kind -ceq 'Directory') { [IO.FileAttributes]::Directory } else { [IO.FileAttributes]::Normal }
    $Projected = $false
    $Valid = $false
    $Failed = $false
    try {
        $Results = @(& $Projection $Security $Case.Kind $Attributes *>&1)
        if ($Results.Count -ne 1 -or $Results[0] -isnot [pscustomobject]) { throw 'PROJECTION_OUTPUT_INVALID' }
        $Projected = $true
        $Policy = EvidenceAcl\Test-HkAclPolicy $Results[0] $SyntheticUser $Case.Kind
        if ($Policy.Valid -isnot [bool]) { throw 'POLICY_OUTPUT_INVALID' }
        $Valid = $Policy.Valid
    } catch {
        # A negative projection is expected to throw; do not emit exceptions or
        # descriptors. Positive cases independently require successful output.
        if ($Case.Projected) { $Failed = $true }
    }
    $After = [Convert]::ToBase64String($Security.GetSecurityDescriptorBinaryForm())
    if ($Before -cne $After -or $Projected -ne $Case.Projected -or $Valid -ne $Case.Valid) { $Failed = $true }
    if ($Failed) { $FailedIds.Add($Case.Id) }
}
$FailureCount = $FailedIds.Count
[pscustomobject][ordered]@{
    scope = 'memory-only-native-acl-projection-tests'
    status = $(if ($FailureCount -eq 0) { 'PASS' } else { 'FAIL' })
    counts = [pscustomobject][ordered]@{ total = $Cases.Count; passed = ($Cases.Count - $FailureCount); failed = $FailureCount }
    failedCaseIds = [string[]]$FailedIds.ToArray()
} | ConvertTo-Json -Depth 4 -Compress
if ($FailureCount -ne 0) { exit 1 }
exit 0
