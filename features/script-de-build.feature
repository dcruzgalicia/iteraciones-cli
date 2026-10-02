# language: es
Característica: La clave script produce un build.sh portable y numerado de forma estable
  Como quien necesita reproducir un build en otra máquina
  Quiero que el build escriba un .sh con rutas relativas al proyecto y pasos numerados
  Para poder reejecutarlo sin que dependa de rutas absolutas de esta máquina

  # #2438 — la clave `script: true` hace que cada build escriba `build.sh` en la
  # raíz. #2448 movió `format.script` a la raíz. #2445/#2456 admiten `mkdir` y
  # `mv` y prohíben `cp`/`rm`/`ln`/`rmdir` y `&&`. #2474 renumera `slot-N` y
  # `cache-N` con la posición del job, porque dos corridas idénticas grababan
  # scripts distintos.

  Regla de negocio: El .sh sólo usa las primitivas que puede ( #2445, #2456)
    Escenario: Admite mkdir y mv, y sigue marcando cp, rm, ln, rmdir y &&
      Dado un script que sólo usa mkdir y mv
      Entonces el guard de primitivas no encuentra ninguna
      Dado un script con cp, rm, ln, rmdir y &&
      Entonces el guard de primitivas encuentra las cinco

  Regla de negocio: Los slots del script se numeran por posición del job (#2474)
    Escenario: Reescribe slot- y cache- con el índice del job y respeta los pasos de un solo job
      Dado un proyecto con dos jobs repartidos en slots del pool 3 y 1
      Cuando grabo la captura del script
      Entonces el script numera los slots desde el job cero y no usa el slot real del pool

  Regla de negocio: La clave script vive en la raíz de la configuración (#2448)
    Escenario: Por defecto es false y acepta true o false
      Dado un proyecto con la configuración
      Cuando leo la configuración del proyecto
      Entonces la clave script es falsa

    Escenario: Format.script ya no se acepta y el error apunta al rename
      Dado un proyecto con la clave script dentro de format
      Cuando leo la configuración del proyecto
      Entonces la lectura falla diciendo que hay que renombrar la clave
