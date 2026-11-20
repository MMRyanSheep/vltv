param([switch]$Offline)

$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$source = Join-Path $project 'target/vrfkit-source'
$build = Join-Path $project 'target/vrfkit-build'
$patch = Join-Path $project 'patches/vrfkit-china-13.10.patch'
$revision = '9ece4ab84dee62cbf8bf34b7996d2efb0593f9c9'
$repository = 'https://github.com/yakisoba0728/vrfkit'

function Run-Git {
    & git @args | Out-Host
    if ($LASTEXITCODE -ne 0) {
        throw "git exited with status $LASTEXITCODE"
    }
}

if (!(Test-Path -LiteralPath (Join-Path $source '.git'))) {
    Run-Git init $source
}
$head = & git -C $source rev-parse --verify --quiet HEAD
if (!$head) {
    Run-Git -C $source -c http.sslBackend=openssl fetch --depth 1 $repository $revision
    Run-Git -C $source checkout --detach FETCH_HEAD
    $head = & git -C $source rev-parse HEAD
}
if ($head -ne $revision) {
    throw "Expected vrfkit revision $revision in $source, found $head"
}

& git -C $source apply --reverse --check $patch 2>$null
if ($LASTEXITCODE -ne 0) {
    Run-Git -C $source apply $patch
}

$cargoArgs = @('build', '--release', '--locked', '--manifest-path',
    (Join-Path $source 'Cargo.toml'), '-p', 'vrfkit', '--target-dir', $build)
if ($Offline) {
    $cargoArgs += '--offline'
}
& cargo @cargoArgs
if ($LASTEXITCODE -ne 0) {
    throw "cargo exited with status $LASTEXITCODE"
}
Write-Output (Join-Path $build 'release/vrfkit.exe')
