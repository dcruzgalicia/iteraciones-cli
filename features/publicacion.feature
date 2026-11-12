# language: es
Característica: metadatos de publicación en el encabezado

  Para que el sitio muestre los metadatos que antes sólo iban al PDF
  Quiero una ficha integrada en la tarjeta de encabezado

  Escenario: El encabezado muestra los metadatos presentes
    Dado que la raíz del proyecto tiene un proyecto con HTML y metadatos de publicación
    Cuando hago un build del proyecto
    Entonces el comando termina con el código de salida 0
    Y el archivo "dist/files/test-document.html" contiene "Texto"
    Y el archivo "dist/files/test-document.html" contiene "Test Document"
    Y el archivo "dist/files/test-document.html" contiene "ISBN"
    Y el archivo "dist/files/test-document.html" contiene "978-607-00-0000-0"
    Y el archivo "dist/files/test-document.html" contiene "Editorial"
    Y el archivo "dist/files/test-document.html" contiene "Resumen"
    Y el archivo "dist/files/test-document.html" contiene "DOI"
    Y el archivo "dist/files/test-document.html" contiene "10.1234/ejemplo"
    Y el archivo "dist/files/test-document.html" contiene "Colaboradoras"
    Y el archivo "dist/files/test-document.html" contiene "Identificador"
    Y el archivo "dist/files/test-document.html" contiene "https://example.com/id"
    Y el archivo "dist/files/test-document.html" no contiene ">Publicación</h2>"

  Escenario: El encabezado no muestra campos vacíos
    Dado que la raíz del proyecto tiene un proyecto con HTML y sólo el título
    Cuando hago un build del proyecto
    Entonces el comando termina con el código de salida 0
    Y el archivo "dist/files/test-document.html" no contiene "ISBN"
    Y el archivo "dist/files/test-document.html" no contiene "DOI"
    Y el archivo "dist/files/test-document.html" no contiene "Cómo citar"

  Escenario: La cita está apagada por defecto
    Dado que la raíz del proyecto tiene un proyecto con HTML y metadatos de publicación sin cita
    Cuando hago un build del proyecto
    Entonces el comando termina con el código de salida 0
    Y el archivo "dist/files/test-document.html" contiene "ISBN"
    Y el archivo "dist/files/test-document.html" no contiene "Cómo citar"

  Escenario: Las palabras clave van en el encabezado y son enlaces
    Dado que la raíz del proyecto tiene un proyecto con HTML y metadatos de publicación
    Cuando hago un build del proyecto
    Entonces el comando termina con el código de salida 0
    Y el archivo "dist/files/test-document.html" contiene "href=\"./keywords/pruebas.html\""
    Y el archivo "dist/files/test-document.html" contiene "Palabras clave"
    Y el slot "related" del archivo "dist/files/test-document.html" no contiene "Palabras clave"
    Y el slot "sidebar" del archivo "dist/files/test-document.html" contiene "Palabras clave"
