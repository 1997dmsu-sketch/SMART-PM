Set-StrictMode -Version 2.0

function Initialize-HkNativeEvidence {
    param([Parameter(Mandatory=$true)][string] $CompilerRef)
    $answer = [ordered]@{ status='BLOCKED'; code='COMPILER_UNAVAILABLE'; compilerRef=$CompilerRef; sourceSHA256=$null; assemblySHA256=$null }
    if ($CompilerRef -cnotmatch '\Ahk-win-compile-[0-9a-f]{32}\z') { $answer.code='REFERENCE_INVALID'; return [pscustomobject]$answer }
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT -or $PSVersionTable.PSEdition -cne 'Desktop' -or
        $PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1) { $answer.code='PLATFORM_UNSUPPORTED'; return [pscustomobject]$answer }
    try {
        $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
        try {
            if ($null -eq $identity.User -or [Security.Principal.WindowsPrincipal]::new($identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
                $answer.code='ELEVATED_OR_IDENTITY_UNSUPPORTED'; return [pscustomobject]$answer
            }
        } finally { $identity.Dispose() }
        if ('SmartPmEvidence.NativeSession' -as [type]) { $answer.code='COMPILER_ALREADY_INITIALIZED'; return [pscustomobject]$answer }
        $sourcePath = Join-Path $PSScriptRoot 'native\NativeEvidence.cs'
        $sourceBytes = [IO.File]::ReadAllBytes($sourcePath)
        $hasher = [Security.Cryptography.SHA256]::Create()
        try { $answer.sourceSHA256 = ([BitConverter]::ToString($hasher.ComputeHash($sourceBytes))).Replace('-','').ToLowerInvariant() }
        finally { $hasher.Dispose() }
        $sourceText = [Text.UTF8Encoding]::new($false,$true).GetString($sourceBytes)
        # Compiler artifacts are public synthetic source/binary artifacts, kept
        # outside the Git worktree. This is not an evidence-root identity gate.
        $workspaceParent = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
        $compilerPath = [IO.Path]::Combine($workspaceParent,$CompilerRef)
        if ([IO.Directory]::Exists($compilerPath) -or [IO.File]::Exists($compilerPath)) { $answer.code='COMPILER_NAME_COLLISION'; return [pscustomobject]$answer }
        $null = [IO.Directory]::CreateDirectory($compilerPath)
        $parameters = [CodeDom.Compiler.CompilerParameters]::new()
        $parameters.GenerateExecutable = $false
        $parameters.GenerateInMemory = $true
        $parameters.IncludeDebugInformation = $false
        $parameters.TreatWarningsAsErrors = $false
        $parameters.CompilerOptions = '/optimize'
        $parameters.TempFiles = [CodeDom.Compiler.TempFileCollection]::new($compilerPath,$true)
        # Explicit output prevents CodeDOM treating the loaded DLL as a
        # disposable implicit temporary assembly. Both DLL and source stay.
        $parameters.OutputAssembly = [IO.Path]::Combine($compilerPath,'NativeEvidence.retained.dll')
        [void]$parameters.ReferencedAssemblies.Add('System.dll')
        [void]$parameters.ReferencedAssemblies.Add('System.Core.dll')
        $provider = [Microsoft.CSharp.CSharpCodeProvider]::new()
        try { $compiled = $provider.CompileAssemblyFromSource($parameters,[string[]]@($sourceText)) }
        finally { $provider.Dispose() }
        if ($compiled.Errors.HasErrors) { $answer.code='COMPILATION_BLOCKED'; return [pscustomobject]$answer }
        $null = $compiled.CompiledAssembly
        if (-not ('SmartPmEvidence.NativeSession' -as [type])) { $answer.code='COMPILATION_BLOCKED'; return [pscustomobject]$answer }
        $hasher = [Security.Cryptography.SHA256]::Create()
        try { $answer.assemblySHA256 = ([BitConverter]::ToString($hasher.ComputeHash([IO.File]::ReadAllBytes($parameters.OutputAssembly)))).Replace('-','').ToLowerInvariant() }
        finally { $hasher.Dispose() }
        $artifact = [ordered]@{ compilerRef=$CompilerRef; sourceSHA256=$answer.sourceSHA256; assemblySHA256=$answer.assemblySHA256; generateInMemory=$true; tempFilesKept=$true }
        $artifactBytes = [Text.UTF8Encoding]::new($false).GetBytes(($artifact | ConvertTo-Json -Compress))
        $artifactStream = [IO.File]::Open([IO.Path]::Combine($compilerPath,'compile.metadata.json'),[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
        try { $artifactStream.Write($artifactBytes,0,$artifactBytes.Length) } finally { $artifactStream.Dispose() }
        $answer.status='PASS'; $answer.code='OK'
    } catch { $answer.status='BLOCKED'; $answer.code='COMPILER_OR_POLICY_BLOCKED' }
    return [pscustomobject]$answer
}

Export-ModuleMember -Function Initialize-HkNativeEvidence
