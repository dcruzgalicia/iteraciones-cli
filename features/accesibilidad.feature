@accesibilidad
Característica: validate reporta la accesibilidad del HTML construido

  Como quien publica un sitio y no quiere auditar todo a mano
  Quiero que validate revise las señales básicas del HTML ya construido
  Para corregir imágenes, enlaces y encabezados sin bloquear el build

  Regla de negocio: Los avisos de accesibilidad se reportan sin bloquear

    Escenario: Un HTML con problemas reales se reporta en la salida legible
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el HTML construido "dist/files/accesibilidad.html" tiene este contenido
      """
      <!doctype html>
      <html lang="es-MX"><body>
      <h1>Título</h1>
      <h3>Salto</h3>
      <img src="sin-alt.png">
      <img src="sin-medidas.png" alt="Foto">
      <a href="/vacio"></a>
      <a href="/bien">Texto</a>
      <img src="bien.png" alt="Foto" width="10" height="10">
      </body></html>
      """
      Cuando corro "validate"
      Entonces el comando termina con el código de salida 0
      Y la salida dice "sin errores"
      Y el error dice "avisos de accesibilidad"
      Y el error dice "imagen sin alt"
      Y el error dice "imagen sin width/height"
      Y el error dice "enlace sin nombre accesible"
      Y el error dice "salto de encabezado"

    Escenario: El JSON declara cada incidencia y el archivo revisado
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el HTML construido "dist/files/accesibilidad.html" tiene este contenido
      """
      <!doctype html>
      <html lang="es-MX"><body>
      <h1>Título</h1>
      <h3>Salto</h3>
      <img src="sin-alt.png">
      <img src="sin-medidas.png" alt="Foto">
      <a href="/vacio"></a>
      </body></html>
      """
      Cuando valido el proyecto pidiendo JSON
      Entonces el comando termina con el código de salida 0
      Y el JSON declara la clave "ok" con el valor verdadero
      Y el JSON de accesibilidad declara 1 archivos revisados
      Y el JSON de accesibilidad declara la incidencia "image-alt"
      Y el JSON de accesibilidad declara la incidencia "image-dimensions"
      Y el JSON de accesibilidad declara la incidencia "empty-link"
      Y el JSON de accesibilidad declara la incidencia "heading-order"
      Y el JSON de accesibilidad incluye el archivo "dist/files/accesibilidad.html"

  Regla de negocio: Un HTML correcto y un proyecto sin build no avisan

    Escenario: Un HTML accesible no declara incidencias
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el HTML construido "dist/files/limpio.html" tiene este contenido
      """
      <!doctype html>
      <html lang="es-MX"><body>
      <h1>Título</h1>
      <h2>Sección</h2>
      <img src="bien.png" alt="Foto" width="10" height="10">
      <a href="/bien">Texto</a>
      </body></html>
      """
      Cuando valido el proyecto pidiendo JSON
      Entonces el comando termina con el código de salida 0
      Y el JSON de accesibilidad declara 1 archivos revisados
      Y el JSON de accesibilidad no declara incidencias

    Escenario: Sin HTML construido no hay nada que revisar
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Cuando valido el proyecto pidiendo JSON
      Entonces el comando termina con el código de salida 0
      Y el JSON de accesibilidad declara 0 archivos revisados
      Y el JSON de accesibilidad no declara incidencias

  Regla de negocio: El reporte nombra los archivos como los ve el proyecto

    Escenario: El estado del build apunta a la salida absoluta y el reporte usa rutas relativas
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y que el estado del build declara la salida "dist/files"
      Y el HTML construido "dist/files/relativo.html" tiene este contenido
      """
      <!doctype html>
      <html lang="es-MX"><body><h1>Título</h1><img src="sin-alt.png"></body></html>
      """
      Cuando valido el proyecto pidiendo JSON
      Entonces el comando termina con el código de salida 0
      Y el JSON de accesibilidad incluye el archivo "dist/files/relativo.html"
