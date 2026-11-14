Característica: fechas visibles en HTML

  Para que un blog muestre sus fechas y un libro las oculte
  Quiero activarlas globalmente y poder sobrescribirlas por documento

  Escenario: Sin showDates no se muestra la fecha
    Dado que la raíz del proyecto tiene un proyecto con HTML y fechas
    Cuando hago un build del proyecto
    Entonces el comando termina con el código de salida 0
    Y el archivo "dist/files/test-document.html" no contiene "<time datetime="

  Escenario: showDates global muestra la fecha
    Dado que la raíz del proyecto tiene un proyecto con HTML y fechas globales
    Cuando hago un build del proyecto
    Entonces el comando termina con el código de salida 0
    Y el archivo "dist/files/test-document.html" contiene '<time datetime="2026-01-01">'

  Escenario: El documento puede ocultar la fecha global
    Dado que la raíz del proyecto tiene un proyecto con HTML, fechas globales y el documento las oculta
    Cuando hago un build del proyecto
    Entonces el comando termina con el código de salida 0
    Y el archivo "dist/files/test-document.html" no contiene "<time datetime="

  Escenario: El documento puede mostrar la fecha sin configuración global
    Dado que la raíz del proyecto tiene un proyecto con HTML y el documento muestra las fechas
    Cuando hago un build del proyecto
    Entonces el comando termina con el código de salida 0
    Y el archivo "dist/files/test-document.html" contiene '<time datetime="2026-01-01">'
