# language: es
@requires-pandoc
@requires-magick
@requires-latex
@requires-pdftoppm
Característica: la tubería entera produce una salida por formato

  Como quien convierte un manuscrito a todos los formatos
  Quiero que un solo build recorra todos los pasos y deje cada salida
  Para no tener que acordarme de qué herramientas se ejecutan ni en qué orden

  # El `.sh` prueba que el build es **reproducible**; este feature prueba que lo
  # que se reproduce es lo **correcto**. No es lo mismo: un replay fiel de un
  # pandoc mal armado también sale idéntico, y el dist estaría igual de roto.
  #
  # Por eso aquí no se mira el script: se mira lo que el build deja en `dist`.
  # El proyecto es el de `script-de-build` — frontmatter con autora, una imagen
  # y una collection, con los cinco formatos activos. Las salidas se nombran
  # por el título del documento más su autora (`manuscrito-por-ana-ruiz.tex`),
  # no por el nombre del archivo.

  Regla de negocio: Cada formato deja su salida en dist

    Esquema del escenario: La salida del formato está en dist
      Dado un proyecto con todos los formatos, una colección y una creadora
      Cuando compilo el proyecto desde cero
      Entonces dist tiene el archivo "<salida>"

      Ejemplos:
        | salida                      |
        | manuscrito-por-ana-ruiz.tex |
        | manuscrito-por-ana-ruiz.pdf |
        | manuscrito-por-ana-ruiz.html |
        | manuscrito-por-ana-ruiz.epub |
        | manuscrito-por-ana-ruiz.md   |
        | antologia.html              |
        | ana-ruiz.html               |

  Regla de negocio: El LaTeX de dist lleva los metadatos del frontmatter

    Escenario: El título y la autora viajan al .tex que compone el build
      Dado un proyecto con todos los formatos, una colección y una creadora
      Cuando compilo el proyecto desde cero
      Entonces el archivo "manuscrito-por-ana-ruiz.tex" de dist contiene "\title{Manuscrito}"
      Y el archivo "manuscrito-por-ana-ruiz.tex" de dist contiene "\author{\mbox{Ana Ruiz}}"

  Regla de negocio: El HTML lleva su título y la hoja de estilos compilada

    Escenario: La página enlaza el CSS que el build compiló
      Dado un proyecto con todos los formatos, una colección y una creadora
      Cuando compilo el proyecto desde cero
      Entonces el archivo "manuscrito-por-ana-ruiz.html" de dist contiene "<title>Manuscrito · T</title>"
      Y el archivo "manuscrito-por-ana-ruiz.html" de dist contiene "assets/css/styles.css"
      Y dist tiene el archivo "assets/css/styles.css"
      Y el archivo "assets/css/styles.css" de dist pesa más de 100 bytes

  Regla de negocio: El markdown de dist se puede reprocesar

    Escenario: El .md conserva el frontmatter y completa el idioma
      Dado un proyecto con todos los formatos, una colección y una creadora
      Cuando compilo el proyecto desde cero
      Entonces el archivo "manuscrito-por-ana-ruiz.md" de dist contiene "language: es-MX"
      Y el archivo "manuscrito-por-ana-ruiz.md" de dist contiene "# Capítulo"

  Regla de negocio: El PDF sale compilado y con el tamaño de un PDF

    Escenario: latexmk deja un PDF real en dist
      Dado un proyecto con todos los formatos, una colección y una creadora
      Cuando compilo el proyecto desde cero
      Entonces el archivo "manuscrito-por-ana-ruiz.pdf" de dist pesa más de 1000 bytes

  Regla de negocio: Las imágenes se procesan una vez y viven en assets

    Escenario: La imagen del frontmatter sale procesada a su directorio
      Dado un proyecto con todos los formatos, una colección y una creadora
      Cuando compilo el proyecto desde cero
      Entonces dist tiene el archivo "assets/images/manuscrito-por-ana-ruiz-foto.jpg"
      Y el archivo "manuscrito-por-ana-ruiz.tex" de dist contiene "assets/images/manuscrito-por-ana-ruiz-foto.jpg"

  Regla de negocio: Cada opción del PDF cambia sólo lo que le corresponde

    # Una opción, una fila. El resto de la tubería no se mueve: por eso el
    # `generate` de los otros formatos sigue produciendo sus salidas y lo
    # único que aparece o desaparece es la portada.
    Esquema del escenario: La portada depende de coverImage
      Dado un proyecto con todos los formatos y coverImage: <valor>
      Cuando compilo el proyecto desde cero
      Entonces dist <portada> el archivo "ana-ruiz.png"
      Y dist tiene el archivo "ana-ruiz.pdf"

      Ejemplos:
        | valor | portada    |
        | true  | sí tiene   |
        | false | no tiene   |

  Regla de negocio: La tubería entera se puede repetir a mano

    # Ésta es la tesis del proyecto: los mismos comandos, en el mismo orden,
    # sobre un árbol limpio. Si el `.sh` dejara un `.aux` o un intermedio que el
    # replay no sabe rehacer, el dist saldría incompleto aunque las comparaciones
    # dieran igual.
    Escenario: bash build.sh reconstruye el mismo dist desde cero
      Dado un proyecto con todos los formatos, una colección y una creadora
      Cuando compilo el proyecto desde cero
      Y guardo una copia de dist
      Y borro dist
      Y reejecuto build.sh con bash
      Entonces el código de salida es 0
      Y dist se reconstruye idéntico salvo PDF y EPUB
