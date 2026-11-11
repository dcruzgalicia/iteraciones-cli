# language: es
Característica: canonical absoluto

  Para que los buscadores sepan la URL preferida de cada página
  Quiero un canonical absoluto cuando el sitio declara su URL base

  Escenario: Una página file tiene canonical absoluto
    Dado que la raíz del proyecto tiene un proyecto con HTML y URL base
    Cuando hago un build del proyecto
    Entonces el comando termina con el código de salida 0
    Y el archivo "dist/files/test-document.html" contiene '<link rel="canonical" href="https://ejemplo.org/revista/test-document.html">'

  Escenario: Sin URL base no hay canonical
    Dado que la raíz del proyecto tiene un proyecto con HTML sin URL base
    Cuando hago un build del proyecto
    Entonces el comando termina con el código de salida 0
    Y el archivo "dist/files/test-document.html" no contiene 'rel="canonical"'

  Escenario: Una página paginada se apunta a sí misma
    Dado que la raíz del proyecto tiene un proyecto con HTML, URL base y colección paginada
    Cuando hago un build del proyecto
    Entonces el comando termina con el código de salida 0
    Y el archivo "dist/files/libro-2.html" contiene '<link rel="canonical" href="https://ejemplo.org/revista/libro-2.html">'
