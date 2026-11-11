# language: es
Característica: feed RSS

  Para que un blog o una convocatoria tenga un feed
  Quiero generar feed.xml con los contenidos que tienen fecha

  Escenario: El feed incluye los contenidos con fecha
    Dado que la raíz del proyecto tiene un proyecto con HTML, URL base y RSS
    Cuando hago un build del proyecto
    Entonces el comando termina con el código de salida 0
    Y el archivo "dist/files/feed.xml" contiene "<rss version=\"2.0\">"
    Y el archivo "dist/files/feed.xml" contiene "<title>Test Document</title>"
    Y el archivo "dist/files/feed.xml" contiene "<link>https://ejemplo.org/revista/test-document.html</link>"
    Y el archivo "dist/files/feed.xml" contiene "<pubDate>"

  Escenario: Sin RSS no se genera el feed
    Dado que la raíz del proyecto tiene un proyecto con HTML, URL base y sin RSS
    Cuando hago un build del proyecto
    Entonces el comando termina con el código de salida 0
    Y el archivo "dist/files/feed.xml" no existe
