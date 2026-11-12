# Despliega la versión en Python en el VPS (alias SSH xalozz) desde el último commit, nunca desde la
# carpeta de trabajo: lo que corre en el servidor es siempre un commit concreto.
#   powershell -ExecutionPolicy Bypass -File deploy\desplegar.ps1
# Usa el ssh/scp de Windows (el agente con la clave está ahí, no en git-bash).
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$ssh = "$env:WINDIR\System32\OpenSSH\ssh.exe"
$scp = "$env:WINDIR\System32\OpenSSH\scp.exe"

Push-Location $repo
try {
    if (git status --porcelain -- soloq deploy config index.html app.js style.css sw.js requirements.txt) {
        throw 'Hay cambios sin commit en el código: haz commit antes de desplegar.'
    }
    $paquete = Join-Path $env:TEMP 'soloq-app.tgz'
    git archive --format=tar.gz -o $paquete HEAD soloq config deploy index.html app.js style.css sw.js `
        manifest.webmanifest favicon.svg favicon-32.png apple-touch-icon.png icon-192.png icon-512.png `
        icon-maskable-512.png requirements.txt README.md
    if ($LASTEXITCODE -ne 0) { throw 'Falló el empaquetado' }
    Write-Host "Desplegando $(git log -1 --format='%h %s')"
    & $scp -q $paquete xalozz:/tmp/soloq-app.tgz
    Get-Content -Raw deploy\instalar.sh | & $ssh xalozz "tr -d '\r' | sed '1s/^\xEF\xBB\xBF//' | sudo bash"
    if ($LASTEXITCODE -ne 0) { throw 'Falló la instalación en el VPS' }
    Remove-Item $paquete
} finally {
    Pop-Location
}
