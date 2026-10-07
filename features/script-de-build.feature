# language: es
Característica: La clave script produce un build.sh portable y numerado de forma estable
  Como quien necesita reproducir un build en otra máquina
  Quiero que el build escriba un .sh con rutas relativas al proyecto y pasos numerados
  Para poder reejecutarlo sin que dependa de rutas absolutas de esta máquina

  Regla de negocio: El .sh sólo usa las primitivas que puede ( #2445, #2456)
    Escenario: Admite mkdir y mv, y sigue marcando cp, rm, ln, rmdir y &&
      Dado un script que sólo usa mkdir y mv
      Entonces el guard de primitivas no encuentra ninguna
      Dado un script con cp, rm, ln, rmdir y &&
      Entonces el guard de primitivas encuentra las cinco

  Regla de negocio: Los slots del script se numeran por posición del job (#2474)
    Escenario: Reescribe slot- y cache- con el índice del job y respeta los pasos de un solo job
      Dado un proyecto con dos jobs repartidos en slots del pool 3 y 1
      Cuando grabo la captura del script
      Entonces el script numera los slots desde el job cero y no usa el slot real del pool

  Regla de negocio: La clave script vive en la raíz de la configuración (#2448)
    Escenario: Por defecto es false y acepta true o false
      Dado un proyecto con la configuración
      Cuando leo la configuración del proyecto
      Entonces la clave script es falsa

    Escenario: Format.script ya no se acepta y el error apunta al rename
      Dado un proyecto con la clave script dentro de format
      Cuando leo la configuración del proyecto
      Entonces la lectura falla diciendo que hay que renombrar la clave

  @requires-pandoc
  Regla de negocio: El .sh declara una sección por fase y usa subcomandos donde hay decisiones
    Escenario: El build.sh se escribe, es ejecutable y sólo contiene comandos
      Dado un proyecto de prueba con la clave script activada
      Cuando compilo el proyecto y leo el build.sh
      Entonces el script existe y es ejecutable
      Y el script cumple este contrato:
        | qué | valor esperado |
        | cabecera | empieza con la cabecera de bash y se mueve a la raíz del proyecto |
        | directorios | los prepara con mkdir y no invoca iteraciones prepare |
        | secciones | declara una sección por cada formato generado |
        | primitivas | no usa comandos del sistema aparte de cd y mkdir |
        | salidas | redirige la salida de cada formato a dist |
        | markdown | lo escribe iteraciones y no un redirect de pandoc |
        | subcomandos prohibidos | no invoca los que rehacen el trabajo |

    Escenario: bash build.sh sale con 0 y deja las salidas idénticas
      Dado un proyecto de prueba con la clave script activada
      Cuando compilo el proyecto y leo el build.sh
      Y guardo una copia de dist
      Y reejecuto build.sh con bash
      Entonces el código de salida es 0
      Y dist se reconstruye idéntico salvo los EPUB

  @requires-pandoc
  Regla de negocio: Las colecciones entran por entradas materializadas y el replay las rehace
    Escenario: Las colecciones entran por collections y el replay sale idéntico
      Dado un proyecto con un documento y una colección que lo incluye
      Cuando compilo el proyecto y leo el build.sh
      Y guardo una copia de dist y de las entradas de las colecciones
      Y borro las entradas materializadas
      Y reejecuto build.sh con bash
      Entonces el código de salida es 0
      Y dist se reconstruye idéntico salvo los EPUB
      Y las entradas de las colecciones se reconstruyen idénticas

  @requires-pandoc
  @requires-magick
  Regla de negocio: Las imágenes se procesan con ImageMagick y el replay las rehace
    Escenario: Incluye ImageMagick y las imágenes procesadas salen idénticas
      Dado un proyecto con una imagen y un documento que la referencia
      Cuando compilo el proyecto y leo el build.sh
      Entonces el script existe y es ejecutable
      Y el script cumple este contrato:
        | qué | valor esperado |
        | sección | declara la sección de imágenes |
        | invocación | invoca ImageMagick |
        | copia única | la imagen procesada vive en el directorio de imágenes del nivel, con el prefijo del slug |
        | raíz de dist | la imagen procesada no se queda en la raíz |
      Cuando guardo una copia de dist
      Y reejecuto build.sh con bash
      Entonces el código de salida es 0
      Y dist se reconstruye idéntico sin excepciones

  @requires-pandoc
  @requires-magick
  Regla de negocio: El post-proceso LaTeX viaja por manifiesto
    Escenario: El post-proceso latex viaja por manifiesto y el tex de dist sale idéntico
      Dado un proyecto con una imagen y un documento que la referencia en LaTeX
      Cuando compilo el proyecto y leo el build.sh
      Entonces el script existe y es ejecutable
      Y el script cumple este contrato:
        | qué | valor esperado |
        | post-proceso | encadena el post-proceso LaTeX con el manifiesto |
        | entrada del post-proceso | lee la salida cruda de pandoc |
      Y el manifiesto de post-proceso tiene una entrada
      Y el archivo de dist existe
      Y el archivo de dist contiene la ruta de la imagen procesada
      Y la imagen procesada no se queda en la raíz de dist
      Cuando guardo una copia de dist
      Y reejecuto build.sh con bash
      Entonces el código de salida es 0
      Y dist se reconstruye idéntico sin excepciones

  @requires-pandoc
  @requires-latex
  Regla de negocio: El PDF se compila con latexmk y sus slots los prepara el CLI
    Escenario: Incluye latexmk con sus pasos de soporte y vuelve a dejar el PDF en dist
      Dado un proyecto con un documento y formato PDF
      Cuando compilo el proyecto desde cero
      Entonces el script existe y es ejecutable
      Y el script cumple este contrato:
        | qué | valor esperado |
        | sección | declara la sección de PDF |
        | compilación | compila con latexmk nombrando el job |
        | slots | deja que iteraciones prepare y collect hagan el trabajo del slot |
        | primitivas | no usa primitivas prohibidas del sistema operativo |
        | intermedio | escribe la salida cruda de pandoc en un intermedio |
      Y el archivo de dist existe
      Y el archivo de dist pesa más de 1000 bytes
      Cuando borro dist
      Y reejecuto build.sh con bash
      Entonces el código de salida es 0
      Y el archivo de dist existe

  @requires-pandoc
  @requires-magick
  @requires-latex
  @requires-pdftotext
  @requires-unzip
  Regla de negocio: build completo y bash build.sh producen el mismo dist
    Escenario: Deja el mismo dist salvo el contenido sustancial de PDF y EPUB
      Dado un proyecto con todos los formatos, una colección y una creadora
      Cuando compilo el proyecto desde cero
      Y guardo una copia de dist
      Y borro dist
      Y reejecuto build.sh con bash
      Entonces el código de salida es 0
      Y dist se reconstruye idéntico salvo PDF y EPUB
      Y el script cumple este contrato:
        | qué | valor esperado |
        | cinco fases | cubre las cinco fases con subcomandos de iteraciones |
        | primitivas | sólo usa mkdir y mv |
