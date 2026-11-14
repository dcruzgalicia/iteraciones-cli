Característica: sitemap.xml

  Para que los buscadores reciban un mapa de las páginas públicas
  Quiero un sitemap con URLs absolutas cuando el sitio declara su URL base

  Escenario: El sitemap incluye las páginas públicas
    Dado que la raíz del proyecto tiene un proyecto con HTML y URL base
    Cuando hago un build del proyecto
    Entonces el comando termina con el código de salida 0
    Y el archivo "dist/files/sitemap.xml" contiene "<loc>https://ejemplo.org/revista/test-document.html</loc>"
    Y el archivo "dist/files/sitemap.xml" no contiene "admin/"

  Escenario: Sin URL base no se genera sitemap
    Dado que la raíz del proyecto tiene un proyecto con HTML sin URL base
    Cuando hago un build del proyecto
    Entonces el comando termina con el código de salida 0
    Y el archivo "dist/files/sitemap.xml" no existe
