# language: es
Característica: El build falla bien y responde en la misma forma

  Como quien lee un error de build a las dos de la mañana
  Quiero que el error me diga qué comando resolverlo
  Para no googlear "latexmk not found" a ciegas

  Regla de negocio: Un error de entorno dice qué comando correr

    Esquema del escenario: Un error de <clase> manda a doctor
      Cuando el build falla con el error <clase>
      Entonces el error dice "ejecuta 'iteraciones doctor'"

      Ejemplos:
        | clase                 |
        | pandoc-falta-entorno  |
        | comando-inexistente   |

    Escenario: Un error de entorno no manda a validate
      Cuando el build falla con el error pandoc-falta-entorno
      Entonces el error no dice "iteraciones validate"

    Escenario: Un error que no es de entorno no manda a doctor
      Cuando el build falla con el error otro
      Entonces el error no dice "iteraciones doctor"

  Regla de negocio: Un estado a medio escribir no rompe el build siguiente

    Escenario: Un estado corrupto dispara un rebuild completo
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Cuando hago un build del proyecto
      Dado que el estado del build quedó corrupto
      Y hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y la salida dice que se procesó 1 documento sin caché
      Y la salida no dice "Sin cambios"
      Y el estado del build queda completo y con schemaVersion 2

  Regla de negocio: El JSON de build tiene exactamente las claves documentadas

    Escenario: El JSON de build no tiene claves de más ni de menos
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Cuando hago un build del proyecto pidiendo JSON
      Entonces el comando termina con el código de salida 0
      Y la salida es una sola línea
      Y el JSON declara exactamente las claves "cached, durationMs, formats, invalidations, outputDir, processed"
      Y el JSON no declara la clave "selected"
      Y el JSON declara "processed" como número
      Y el JSON declara "cached" como número
      Y el JSON declara "formats" como lista
      Y el JSON declara "invalidations" como lista
      Y el JSON declara "outputDir" como texto
      Y el JSON declara "durationMs" como número

  Regla de negocio: El PDF sale válido de extremo a extremo

    @requires-pandoc
    @requires-latex
    Escenario: Un build con índice genera un PDF real
      Dado que la raíz del proyecto tiene un proyecto con PDF y con índice
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/test-document.pdf" existe
      Y el archivo "dist/files/test-document.pdf" lleva la firma "%PDF"

    @requires-pandoc
    @requires-latex
    Escenario: 99-pdfx activo produce un PDF con /TrimBox
      Dado que la raíz del proyecto tiene un proyecto con 97 y 98 desactivados
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/test-document.pdf" declara "/TrimBox"
      Y el PDF pasa la certificación X-1a

    @requires-pandoc
    @requires-latex
    Escenario: 97-eso-pic activo compila sin choque de opciones
      Dado que la raíz del proyecto tiene un proyecto con 98 y 99 desactivados
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/test-document.pdf" existe

  Regla de negocio: La portada se genera con el documento y desaparece sin él

    @requires-pandoc
    @requires-latex
    Escenario: coverImage genera la portada PNG junto al PDF
      Dado que la raíz del proyecto tiene un proyecto con portada
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/test-document.png" existe
      Y el archivo "dist/files/test-document.png" lleva la firma "PNG"

    @requires-pandoc
    @requires-latex
    Escenario: coverImage en la raíz de la configuración también funciona
      Dado que la raíz del proyecto tiene un proyecto con portada en la raíz
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/test-document.png" existe

    @requires-pandoc
    @requires-latex
    Escenario: Un build sin cambios con PDF no vuelve a encolar nada
      Dado que la raíz del proyecto tiene un proyecto con HTML y PDF
      Cuando hago un build del proyecto
      Y el archivo "dist/files/test-document.pdf" existe
      Y el archivo "dist/files/test-document.png" no existe
      Y hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y la salida dice "(todos reutilizados)"
      Y la salida no dice "documento modificado"

    @requires-pandoc
    @requires-latex
    Escenario: Desactivar la portada borra las PNG huérfanas
      Dado que la raíz del proyecto tiene un proyecto con portada
      Cuando hago un build del proyecto
      Y el archivo "dist/files/test-document.png" existe
      Dado que la raíz del proyecto tiene un proyecto con PDF
      Y hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/test-document.png" no existe