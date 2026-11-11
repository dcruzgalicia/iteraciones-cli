# language: es
Característica: robots.txt

  Para que los buscadores encuentren el sitemap
  Quiero un robots.txt que permita el sitio y lo referencie

  Escenario: Con URL base el robots apunta al sitemap
    Dado que la raíz del proyecto tiene un proyecto con HTML y URL base
    Cuando hago un build del proyecto
    Entonces el comando termina con el código de salida 0
    Y el archivo "dist/files/robots.txt" contiene "User-agent: *"
    Y el archivo "dist/files/robots.txt" contiene "Sitemap: https://ejemplo.org/revista/sitemap.xml"

  Escenario: Sin URL base el robots no inventa un sitemap
    Dado que la raíz del proyecto tiene un proyecto con HTML sin URL base
    Cuando hago un build del proyecto
    Entonces el comando termina con el código de salida 0
    Y el archivo "dist/files/robots.txt" contiene "Allow: /"
    Y el archivo "dist/files/robots.txt" no contiene "Sitemap:"
