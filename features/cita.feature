Característica: bloque Cómo citar

  Para citar una publicación sin reconstruir sus metadatos
  Quiero una cita en APA y descargas BibTeX y RIS

  Escenario: La página ofrece la cita y sus exportaciones
    Dado que la raíz del proyecto tiene un proyecto con HTML y metadatos de publicación
    Cuando hago un build del proyecto
    Entonces el comando termina con el código de salida 0
    Y el archivo "dist/files/test-document.html" contiene "Cómo citar"
    Y el archivo "dist/files/test-document.html" contiene "cita.bib"
    Y el archivo "dist/files/test-document.html" contiene "cita.ris"
    Y el archivo "dist/files/test-document.html" contiene "@misc{test-document"
    Y el archivo "dist/files/test-document.html" contiene "TY  - GEN"
    Y el archivo "dist/files/test-document.html" contiene "data:"
