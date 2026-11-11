# language: es
Característica: ficha de metadatos de publicación

  Para que el sitio muestre los metadatos que antes sólo iban al PDF
  Quiero una ficha con los campos que existan

  Escenario: La ficha muestra los metadatos presentes
    Dado que la raíz del proyecto tiene un proyecto con HTML y metadatos de publicación
    Cuando hago un build del proyecto
    Entonces el comando termina con el código de salida 0
    Y el archivo "dist/files/test-document.html" contiene "Publicación"
    Y el archivo "dist/files/test-document.html" contiene "ISBN"
    Y el archivo "dist/files/test-document.html" contiene "978-607-00-0000-0"
    Y el archivo "dist/files/test-document.html" contiene "Editorial"
    Y el archivo "dist/files/test-document.html" contiene "Resumen"

  Escenario: La ficha no muestra campos vacíos
    Dado que la raíz del proyecto tiene un proyecto con HTML y sólo el título
    Cuando hago un build del proyecto
    Entonces el comando termina con el código de salida 0
    Y el archivo "dist/files/test-document.html" no contiene ">Publicación</h2>"
