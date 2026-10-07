# language: es
Característica: el tipo `intervention`

  Como quien edita una regla de imprenta
  Quiero que su frontmatter valide `pages` y `lineLength` y no exija título
  Para que una intervención con tres páginas en blanco se describa en tres
  líneas y no en un párrafo

  # Tramo 25 de la migración. 11 de los 18 casos de `intervention.test.ts`.

  # Una intervention es un recurso de imprenta, no un documento con contenido:
  # por eso no pide título ni autor, y sus campos son un entero de páginas y
  # un decimal de longitud de línea.

  Regla de negocio: Lo que una intervention acepta

    Esquema del escenario: Un frontmatter de intervention válido
      Dado que la raíz del proyecto está vacía
      Cuando valido el frontmatter:
      """
      <fm>
      """
      Entonces no hay errores de frontmatter

      Ejemplos:
        | fm |
        | {"type":"intervention"} |
        | {"type":"intervention","pages":3} |
        | {"type":"intervention","lineLength":0.6} |
        | {"type":"intervention","date":"2026-01-01"} |
        | {"type":"intervention","pages":2,"lineLength":0.5} |

    # Ni título ni autor: una intervención es una regla con nombre, y el
    # nombre ya está en el `type`. Pedir título sería inventar un campo que el
    # autor no tiene por qué rellenar.
    Escenario: Sin título ni autor la intervention es válida
      Dado que la raíz del proyecto está vacía
      Cuando valido el frontmatter:
      """
      {"type":"intervention","date":"2026-01-01"}
      """
      # Ni título ni autor: una intervención es una regla con nombre, y el
      # nombre ya está en el type.
      Entonces no hay errores de frontmatter

  Regla de negocio: Lo que una intervention rechaza

    # `pages` es un entero POSITIVO: cero páginas y negativas no son un libro,
    # son un error de tipeo. Y `lineLength` es un decimal entre 0 y 1: es una
    # fracción del ancho, no un número de líneas.

    Esquema del escenario: Un frontmatter de intervention inválido
      Dado que la raíz del proyecto está vacía
      Cuando valido el frontmatter:
      """
      <fm>
      """
      Entonces hay 1 errores de frontmatter
      Y algún error menciona "<campo>"

      Ejemplos:
        | fm | campo |
        | {"type":"intervention","pages":"two"} | pages |
        | {"type":"intervention","pages":0} | pages |
        | {"type":"intervention","pages":-1} | pages |
        | {"type":"intervention","lineLength":1.5} | lineLength |

    Escenario: Un type que no es intervention se valida como desconocido
      Dado que la raíz del proyecto está vacía
      Cuando valido el frontmatter:
      """
      {"type":"invalid"}
      """
      # El mensaje nombra intervention: el autor escribió un type que no
      # existe y tiene que saber cuáles hay.
      Entonces hay 1 errores de frontmatter
      Y algún error menciona "intervention"

  Regla de negocio: Cada tipo de documento trae sus propios preámbulos

    # Un PDF de intervención se compone distinto al de un documento, y por eso
    # tiene su propio juego de filtros. Pero el juego tiene que ser el mismo
    # tamaño: si el PDF de intervención pierde un filtro que el de documento
    # tiene, la maquetación sale distinta y nadie sabe por qué.

    Escenario: Los preámbulos de intervention se cargan
      Dado que la raíz del proyecto está vacía
      Cuando cargo los preámbulos de "intervention"
      Entonces los preámbulos cargados traen "19-maketitle"
      Y los preámbulos cargados traen "28-titlepages"

    Escenario: Intervention trae tantos preámbulos como file
      Dado que la raíz del proyecto está vacía
      Cuando cargo los preámbulos de "intervention"
      Y cargo también los preámbulos de file
      # Si un filtro se perdiera por el camino, el PDF saldría con una
      # maquetación distinta y el aviso no diría nada.
      Entonces los preámbulos de intervention traen los mismos que los de file
  # --- Tramo 33: los 6 casos que quedaban de `intervention.test.ts` ---

  # Una intervention es un recurso de imprenta, no un capítulo. El PDF y el
  # markdown exportado la conservan porque ahí tiene sentido; ni la página HTML
  # ni el EPUB la llevan.

  Regla de negocio: La intervention no es un capítulo legible

    Escenario: No sale en las tarjetas de la página HTML
      Dado que la raíz del proyecto está vacía
      Y una colección con un documento y una intervention
      Cuando compongo las tarjetas de la colección
      # Su HTML propio no existe, así que tampoco puede enlazarse.
      Entonces las tarjetas incluyen "Contenido de doc."
      Y las tarjetas no incluyen "regla de imprenta"
      Y las tarjetas no incluyen "./regla-de-imprenta.html"

    Escenario: No sale en el EPUB
      Dado que la raíz del proyecto está vacía
      Y una colección con un documento y una intervention
      Cuando compongo el cuerpo de la colección para "html"
      # El EPUB se arma con la misma ruta que la página.
      Entonces el cuerpo incluye "Contenido de doc."
      Y el cuerpo no incluye "regla de imprenta"

    # En el PDF sí está, y con su sección de imprenta (`\rule{`): es el único
    # formato donde la regla tiene sentido.
    Escenario: Se queda en el PDF y en el markdown exportado
      Dado que la raíz del proyecto está vacía
      Y una colección con un documento y una intervention
      Cuando compongo el cuerpo de la colección para "latex"
      Entonces el cuerpo incluye "regla de imprenta"
      Y el cuerpo incluye "\rule{"
      Cuando compongo el cuerpo de la colección para "markdown"
      # El markdown exportado también: quien lo importe conserva la regla.
      Entonces el cuerpo incluye "regla de imprenta"

  Regla de negocio: Una colección sólo de interventions no se puede construir (#2485)

    # Sin un documento que leer, la colección es sólo reglas de imprenta: no
    # hay nada que publicar. El mensaje dice las dos cosas —qué pasó y qué hace
    # falta— porque el autor tiene que saber qué cambiar.

    Escenario: El build falla y avisa, y no publica la página
      Dado que la raíz del proyecto está vacía
      Y un proyecto cuya colección sólo incluye interventions
      Cuando construyo el proyecto capturando stderr
      # El código de salida 1 y el aviso con las dos condiciones.
      Entonces la construcción termina con código 1
      Y el aviso de la construcción dice "todos los archivos de files[] son \"type: intervention\""
      Y el aviso de la construcción dice "al menos un archivo de otro tipo"
      Y la página "antologia.html" NO se generó

    # El build entero: ni la página HTML ni el EPUB la llevan, y el EPUB se
    # sigue generando sin ella. La intervention no tiene página propia porque
    # no es un capítulo.
    Escenario: El build deja la intervention fuera del HTML y del EPUB
      Dado que la raíz del proyecto está vacía
      Y un proyecto con una colección que incluye una intervention
      Cuando construyo el proyecto capturando stderr
      Entonces la construcción termina con código 0
      Y la página "antologia.html" se generó
      Y la página "antologia.epub" se generó
      Y la página "regla.html" NO se generó
      Y el HTML de la colección no contiene "regla de imprenta"
