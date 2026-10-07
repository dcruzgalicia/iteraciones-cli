# language: es
Característica: preparar los directorios que asumen los comandos externos

  Como quien va a correr pandoc y latexmk a mano
  Quiero que el CLI me cree los directorios y me deje la plantilla XMP en su sitio
  Para no tener que acordarme del `mkdir` de cada slot antes de compilar

  # El paso 0 de la tubería. Dentro del build lo hace `iteraciones prepare`; por
  # fuera es el mismo comando a mano, y es exactamente lo que el `build.sh`
  # escribe en su primera fase. El proyecto lo expone como subcomando público
  # (`iteraciones prepare`) porque es el paso que más se repite al depurar: se
  # compila un slot, se mira el LaTeX y se vuelve a compilar.

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

    # El slot es el directorio temporal de latexmk. La plantilla se llama
    # `pdfx.xmp` porque es lo que `99-pdfx` lee al compilar: sin ella, el PDF no
    # lleva los metadatos de catálogo.

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

    # Un `prepare` sin argumentos que no dice nada parece un comando que
    # funcionó. El error nombra la flag que falta.

    Escenario: prepare sin --dir ni --xmp explica el uso
      Dado que la raíz del proyecto está vacía
      Cuando parseo el comando "prepare" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 1
      Y el error dice "falta --dir"
