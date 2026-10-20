# language: es
Característica: los snapshots del HTML

  Como quien publica un sitio
  Quiero una captura de cada página
  Para saber si el HTML cambió sin que me dé cuenta

  Regla de negocio: Guardar captura cada página del sitio

    Escenario: Guardar deja la captura del HTML en la línea base
      Dado que la raíz del proyecto está vacía
      Y la salida tiene estas rutas HTML:
      """
      index.html
      anexos/otro.html
      """
      Cuando guardo los snapshots de ""
      Entonces el snapshots termina con código 0
      Y el archivo "snapshots/index--html--page-001.png" existe en el proyecto
      Y el archivo "snapshots/anexos--otro--html--page-001.png" existe en el proyecto

    Escenario: Una página sin cambios da cero diferencias
      Dado que la raíz del proyecto está vacía
      Y la salida tiene estas rutas HTML:
      """
      index.html
      """
      Cuando guardo los snapshots de ""
      Y comparo ""
      Entonces el snapshots termina con código 0

  Regla de negocio: Comparar avisa de los cambios

    Escenario: Una página que cambia deja su diff
      Dado que la raíz del proyecto está vacía
      Y la salida tiene estas rutas HTML:
      """
      index.html
      """
      Cuando guardo los snapshots de ""
      Y cambio la ruta HTML "index.html" por "<html><body>otra cosa</body></html>"
      Y comparo ""
      Entonces el snapshots termina con código 1
      Y el archivo "diff/index--html--page-001--diff.png" existe en el proyecto
