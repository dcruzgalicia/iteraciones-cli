# language: es
Característica: el tipo `intervention`

  Como quien edita una regla de imprenta
  Quiero que su frontmatter valide `pages` y `lineLength` y no exija título
  Para que una intervención con tres páginas en blanco se describa en tres
  líneas y no en un párrafo

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

    Escenario: Sin título ni autor la intervention es válida
      Dado que la raíz del proyecto está vacía
      Cuando valido el frontmatter:
      """
      {"type":"intervention","date":"2026-01-01"}
      """
      Entonces no hay errores de frontmatter

  Regla de negocio: Lo que una intervention rechaza

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
      Entonces hay 1 errores de frontmatter
      Y algún error menciona "intervention"

  Regla de negocio: Cada tipo de documento trae sus propios preámbulos

    Escenario: Los preámbulos de intervention se cargan
      Dado que la raíz del proyecto está vacía
      Cuando cargo los preámbulos de "intervention"
      Entonces los preámbulos cargados traen "19-maketitle"
      Y los preámbulos cargados traen "28-titlepages"

    Escenario: Intervention trae tantos preámbulos como file
      Dado que la raíz del proyecto está vacía
      Cuando cargo los preámbulos de "intervention"
      Y cargo también los preámbulos de file
      Entonces los preámbulos de intervention traen los mismos que los de file

  Regla de negocio: La intervention no es un capítulo legible

    Escenario: No sale en las tarjetas de la página HTML
      Dado que la raíz del proyecto está vacía
      Y una colección con un documento y una intervention
      Cuando compongo las tarjetas de la colección
      Entonces las tarjetas incluyen "Contenido de doc."
      Y las tarjetas no incluyen "regla de imprenta"
      Y las tarjetas no incluyen "./regla-de-imprenta.html"

    Escenario: No sale en el EPUB
      Dado que la raíz del proyecto está vacía
      Y una colección con un documento y una intervention
      Cuando compongo el cuerpo de la colección para "html"
      Entonces el cuerpo incluye "Contenido de doc."
      Y el cuerpo no incluye "regla de imprenta"

    Escenario: Se queda en el PDF y en el markdown exportado
      Dado que la raíz del proyecto está vacía
      Y una colección con un documento y una intervention
      Cuando compongo el cuerpo de la colección para "latex"
      Entonces el cuerpo incluye "regla de imprenta"
      Y el cuerpo incluye "\rule{"
      Cuando compongo el cuerpo de la colección para "markdown"
      Entonces el cuerpo incluye "regla de imprenta"

  Regla de negocio: Una colección sólo de interventions no se puede construir (#2485)

    Escenario: El build falla y avisa, y no publica la página
      Dado que la raíz del proyecto está vacía
      Y un proyecto cuya colección sólo incluye interventions
      Cuando construyo el proyecto capturando stderr
      Entonces la construcción termina con código 1
      Y el aviso de la construcción dice "todos los archivos de files[] son \"type: intervention\""
      Y el aviso de la construcción dice "al menos un archivo de otro tipo"
      Y la página "antologia.html" NO se generó

    Escenario: El build deja la intervention fuera del HTML y del EPUB
      Dado que la raíz del proyecto está vacía
      Y un proyecto con una colección que incluye una intervention
      Cuando construyo el proyecto capturando stderr
      Entonces la construcción termina con código 0
      Y la página "antologia.html" se generó
      Y la página "antologia.epub" se generó
      Y la página "regla.html" NO se generó
      Y el HTML de la colección no contiene "regla de imprenta"
