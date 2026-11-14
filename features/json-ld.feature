Característica: datos estructurados JSON-LD

  Para que un buscador sepa si una página es un artículo o una persona
  Quiero JSON-LD válido por tipo, sin campos vacíos

  Escenario: Un archivo emite Article
    Dado que la raíz del proyecto tiene un proyecto con HTML, URL base, fecha y autora
    Cuando hago un build del proyecto
    Entonces el comando termina con el código de salida 0
    Y el archivo "dist/files/test-document-por-ana-ruiz.html" contiene '<script type="application/ld+json">'
    Y el archivo "dist/files/test-document-por-ana-ruiz.html" contiene '"@type":"Article"'
    Y el archivo "dist/files/test-document-por-ana-ruiz.html" contiene '"headline":"Test Document"'
    Y el archivo "dist/files/test-document-por-ana-ruiz.html" contiene '"datePublished":"2026-01-01"'

  Escenario: Una creadora emite Person
    Dado que la raíz del proyecto tiene un proyecto con HTML, URL base y creadora
    Cuando hago un build del proyecto
    Entonces el comando termina con el código de salida 0
    Y el archivo "dist/files/ana-ruiz.html" contiene '"@type":"Person"'
    Y el archivo "dist/files/ana-ruiz.html" contiene '"name":"Ana Ruiz"'
