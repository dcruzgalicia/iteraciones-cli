Característica: meta description por página

  Para que los buscadores y las vistas previas tengan un resumen
  Quiero una meta description con el frontmatter o la del sitio como respaldo

  Escenario: La descripción del frontmatter llega al head
    Dado que la raíz del proyecto tiene un proyecto con HTML y descripción propia
    Cuando hago un build del proyecto
    Entonces el comando termina con el código de salida 0
    Y el archivo "dist/files/test-document.html" contiene '<meta name="description" content="Descripción de prueba">'

  Escenario: Sin descripción propia usa la del sitio
    Dado que la raíz del proyecto tiene un proyecto con HTML y descripción del sitio
    Cuando hago un build del proyecto
    Entonces el comando termina con el código de salida 0
    Y el archivo "dist/files/test-document.html" contiene '<meta name="description" content="Sitio de prueba">'
