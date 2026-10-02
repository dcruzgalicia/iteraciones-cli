# language: es
@requires-pandoc
Característica: El build deja un build.sh que se puede reejecutar
  Como quien necesita reproducir un build en otra máquina
  Quiero que el build escriba un build.sh con los comandos externos que corrieron
  Para reejecutarlos sin volver a pasar por el CLI

  # #2438 — `script: true` hace que cada build escriba `build.sh` en la raíz del
  # proyecto. El contrato es que `bash build.sh` salga con 0 y deje las mismas
  # salidas byte a byte. Este feature usa pandoc de verdad: es un E2E con
  # subprocess real, no una simulación.
  Escenario: build.sh se escribe, es ejecutable y sólo contiene comandos
    Dado un proyecto de prueba con la clave script activada
    Cuando corro el build
    Entonces build.sh existe y es ejecutable
    Y build.sh empieza con la cabecera de bash y se mueve a la raíz del proyecto
    Y build.sh prepara sus directorios con mkdir y no invoca iteraciones prepare
    Y build.sh tiene una sección por cada formato generado
    Y build.sh no invoca ningún comando de sistema aparte de cd y mkdir
    Y build.sh redirige la salida de cada formato a dist
    Y el markdown de dist lo escribe iteraciones y no un redirect de pandoc
    Y build.sh no invoca los subcomandos de iteraciones que rehacen el trabajo

  Escenario: bash build.sh sale con 0 y deja las salidas idénticas
    Dado un proyecto de prueba con la clave script activada
    Cuando corro el build
    Y guardo una copia de las salidas de dist
    Cuando reejecuto build.sh con bash
    Entonces el código de salida es 0
    Y dist tiene los mismos archivos que antes
    Y cada archivo es idéntico byte a byte salvo el epub