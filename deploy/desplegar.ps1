# Despliega la versión en Python en el VPS (alias SSH xalozz) desde el último commit, nunca desde la
# carpeta de trabajo: lo que corre en el servidor es siempre un commit concreto.
#   powershell -ExecutionPolicy Bypass -File deploy\desplegar.ps1
# Usa el ssh/scp de Windows (el agente con la clave está ahí, no en git-bash).
# La web nueva (web/, React) se compila aquí (en el VPS no hay Node) sobre una copia del commit y va en el
# paquete como web/dist; el servidor la sirve si está y, si no, la web antigua de la raíz.
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$ssh = "$env:WINDIR\System32\OpenSSH\ssh.exe"
$scp = "$env:WINDIR\System32\OpenSSH\scp.exe"

Push-Location $repo
$tmp = Join-Path $env:TEMP "soloq-despliegue-$PID"
try {
    if (git status --porcelain -- soloq deploy config web index.html app.js style.css sw.js requirements.txt) {
        throw 'Hay cambios sin commit en el código: haz commit antes de desplegar.'
    }
    # Copia limpia del último commit
    if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
    New-Item -ItemType Directory -Force "$tmp\src" | Out-Null
    git archive --format=tar -o "$tmp\src.tar" HEAD
    if ($LASTEXITCODE -ne 0) { throw 'Falló git archive' }
    tar -xf "$tmp\src.tar" -C "$tmp\src"
    if ($LASTEXITCODE -ne 0) { throw 'Falló al extraer el commit' }

    # Compilar la web sobre esa copia (npm ci: exactamente las versiones de package-lock.json)
    Push-Location "$tmp\src\web"
    try {
        $env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = '1'
        npm ci --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'Falló npm ci' }
        npm run build
        if ($LASTEXITCODE -ne 0) { throw 'Falló la compilación de la web' }
    } finally {
        Pop-Location
    }

    $paquete = Join-Path $env:TEMP 'soloq-app.tgz'
    tar -czf $paquete -C "$tmp\src" soloq config deploy index.html app.js style.css sw.js `
        manifest.webmanifest favicon.svg favicon-32.png apple-touch-icon.png icon-192.png icon-512.png `
        icon-maskable-512.png requirements.txt README.md web/dist
    if ($LASTEXITCODE -ne 0) { throw 'Falló el empaquetado' }
    Write-Host "Desplegando $(git log -1 --format='%h %s')"
    & $scp -q $paquete xalozz:/tmp/soloq-app.tgz
    Get-Content -Raw deploy\instalar.sh | & $ssh xalozz "tr -d '\r' | sed '1s/^\xEF\xBB\xBF//' | sudo bash"
    if ($LASTEXITCODE -ne 0) { throw 'Falló la instalación en el VPS' }
    Remove-Item $paquete
} finally {
    if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
    Pop-Location
}
