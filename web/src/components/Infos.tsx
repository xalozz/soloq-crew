// Textos de las ventanas de ayuda: Best 5, instalar la app y vista de móvil
export function Best5Info() {
  return (
    <div className="info-body">
      <h4>Por rendimiento</h4>
      <p>{'Cada jugador recibe una puntuación en cada rol con su '}<b>winrate ajustado</b>:</p>
      <div className="formula">(victorias + 10) / (partidas + 20)</div>
      <p>Es como si todos empezaran con 10 victorias y 10 derrotas "fantasma": con muchas partidas casi no cambia nada, con pocas se acerca al 50 %. Así 5 de 5 no gana a 60 de 100.</p>
      <p><b>{'Ejemplo: '}</b>41 victorias en 75 partidas (54,7 %) → 51 / 95 = 53,7 %.</p>
      <h4>Quién puede ir a cada rol</h4>
      <p>Solo los roles que el jugador juega de verdad: mínimo 10 partidas en ese rol y al menos el 20 % de todas las suyas.</p>
      <h4>Cómo se forma el quinteto</h4>
      <p>{'Se prueban todas las combinaciones posibles sin repetir jugador y gana la que '}<b>más suma entre los cinco roles</b>. Por eso alguien puede salir en su segundo mejor rol si así el equipo entero sale mejor.</p>
      <h4>El campeón de cada casilla</h4>
      <p>Su mejor campeón en ese rol (mínimo 3 partidas) con un ajuste más suave: (victorias + 2) / (partidas + 4).</p>
      <p><b>{'Pick con mejor winrate: '}</b>el mejor campeón del grupo en ese rol, lo juegue quien lo juegue (mínimo 10 partidas, misma fórmula). Puede no coincidir con el jugador elegido: un jugador puede tener un gran campeón pero peor media en el rol.</p>
      <h4>Por elo</h4>
      <p>Mismas condiciones para entrar en un rol, pero puntúa el rango de cada jugador en lugar del winrate.</p>
      <p><span className="muted">Datos: partidas de SoloQ de la temporada de la cuenta principal de cada uno.</span></p>
    </div>
  );
}

export function InstallInfo() {
  const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  return (
    <div className="info-body">
      {standalone ? <p>Ya la estás usando como app 👌</p>
        : ios ? <>
          <p>En el iPhone se instala desde Safari:</p>
          <ol>
            <li>{'Pulsa el botón '}<b>Compartir</b> (el cuadrado con la flecha).</li>
            <li>{'Elige '}<b>Añadir a pantalla de inicio</b>.</li>
            <li>{'Pulsa '}<b>Añadir</b>.</li>
          </ol>
        </> : <>
          <p>{'En Android, abre el menú del navegador (⋮) y pulsa '}<b>Instalar aplicación</b>{' o '}<b>Añadir a pantalla de inicio</b>.</p>
          <p>En el ordenador (Chrome o Edge), usa el icono de instalar de la barra de direcciones.</p>
        </>}
      <p><span className="muted">Se abre a pantalla completa, con el icono de SoloQ Crew, y si no hay conexión enseña los últimos datos.</span></p>
    </div>
  );
}

export function DesktopInfo() {
  return (
    <div className="info-body">
      <p>{'Ahora mismo la vista de ordenador la ha puesto '}<b>Chrome</b> (su ajuste «Sitio de escritorio») y manda sobre este botón, también dentro de la app instalada. Para quitarla:</p>
      <ol>
        <li>{'Abre Chrome, el navegador normal, y pulsa '}<b>⋮ → Configuración</b>.</li>
        <li>{'Entra en '}<b>Configuración de sitios → Sitio de escritorio</b> (puede llamarse «Versión para ordenador»).</li>
        <li>{'Déjalo en '}<b>Vista predeterminada</b>{' o quita la excepción de '}<b>{location.hostname}</b>.</li>
      </ol>
      <p>Luego cierra la app y vuelve a abrirla. A partir de ahí este botón cambia entre las dos vistas.</p>
    </div>
  );
}
