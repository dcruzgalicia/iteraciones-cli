# language: es
Característica: preparar los directorios que asumen los comandos externos

  Como quien va a correr pandoc y latexmk a mano
  Quiero que el CLI me cree los directorios y me deje la plantilla XMP en su sitio
  Para no tener que acordarme del `mkdir` de cada slot antes de compilar

  Regla de negocio: Los directorios que se piden quedan creados

    Esquema del escenario: Cada --dir crea su directorio
      Dado que la raíz del proyecto está vacía
      Cuando parseo el comando "prepare <flags>" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 0
      Y el directorio "<dirs>" existe

      Ejemplos:
        | flags                       | dirs             |
        | --dir dist                  | dist             |
        | --dir dist --dir dist/css   | dist             |
        | --dir dist --dir assets/img | assets           |

  Regla de negocio: La plantilla XMP va al slot que se le pide

    Esquema del escenario: Cada --xmp recibe la plantilla
      Dado que la raíz del proyecto está vacía
      Cuando parseo el comando "prepare <flags>" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 0
      Y el directorio "<dirs>" existe
      Y el archivo "<dirs>/pdfx.xmp" existe

      Ejemplos:
        | flags                                  | dirs    |
        | --xmp slot-1                           | slot-1  |
        | --xmp slot-1 --xmp slot-2              | slot-2  |
        | --dir dist --xmp slot-1                | slot-1  |

  Regla de negocio: --dir y --xmp se pueden repetir yecutorizar lo mismo

    Escenario: Un slot se prepara con sus dos flags a la vez
      Dado que la raíz del proyecto está vacía
      Cuando parseo el comando "prepare --dir .iteraciones/tmp/pdf/slot-1 --xmp .iteraciones/tmp/pdf/slot-1" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 0
      Y el directorio ".iteraciones/tmp/pdf/slot-1" existe
      Y el archivo ".iteraciones/tmp/pdf/slot-1/pdfx.xmp" existe

  Regla de negocio: Sin nada que preparar el comando lo dice

    Escenario: prepare sin --dir ni --xmp explica el uso
      Dado que la raíz del proyecto está vacía
      Cuando parseo el comando "prepare" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 1
      Y el error dice "falta --dir"
