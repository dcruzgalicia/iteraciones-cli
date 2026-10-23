# language: es
Característica: El type list, una colección que se arma sola

  Como quien publica una antología que cambia cada mes
  Quiero que la página se arme sola con lo que hay
  Para no mantener una lista de archivos a mano

  Regla de negocio: Sin filtro sale todo el proyecto

    Escenario: La lista trae los documentos con cuerpo y se excluye a sí misma
      Dado que la raíz del proyecto está vacía
      Y que el proyecto tiene:
      """
      {"lista.md": "---\ntitle: Todos\ntype: list\n---\n", "a.md": "---\ntitle: A\n---\n\nCuerpo.\n", "b.md": "---\ntitle: B\n---\n\nCuerpo.\n", "inter.md": "---\ntype: intervention\n---\n\nIntervención.\n"}
      """
      Cuando descubro y post-proceso el proyecto
      Entonces los miembros de "lista.md" son "a.md, b.md"

    Escenario: Sin fecha se usa la última modificación
      Dado que la raíz del proyecto está vacía
      Y que el proyecto tiene:
      """
      {"lista.md": "---\ntitle: Todos\ntype: list\n---\n", "a.md": "---\ntitle: A\ndate: 2000-01-01\n---\n\nCuerpo.\n", "b.md": "---\ntitle: B\n---\n\nCuerpo.\n"}
      """
      Cuando descubro y post-proceso el proyecto
      Entonces los miembros de "lista.md" son "b.md, a.md"

  Regla de negocio: Cada filtro acota

    Esquema del escenario: El filtro decide qué entra
      Dado que la raíz del proyecto está vacía
      Y que el proyecto tiene:
      """
      <documentos>
      """
      Cuando descubro y post-proceso el proyecto
      Entonces los miembros de "lista.md" son "<miembros>"

      Ejemplos:
        | documentos | miembros |
        | {"lista.md": "---\ntitle: Todos\ntype: list\nfilter:\n  type: creator\n---\n", "a.md": "---\ntitle: A\n---\n\nCuerpo.\n", "creadora.md": "---\ntype: creator\nname: Ana\n---\n\nBio.\n"} | creadora.md |
        | {"lista.md": "---\ntitle: Todos\ntype: list\nfilter:\n  creator: ana\n---\n", "a.md": "---\ntitle: A\ncreator: Ana García\n---\n\nCuerpo.\n", "b.md": "---\ntitle: B\ncreator: Beto Ruiz\n---\n\nCuerpo.\n"} | a.md |
        | {"lista.md": "---\ntitle: Todos\ntype: list\nfilter:\n  date:\n    from: 2026-02-01\n    to: 2026-12-31\n---\n", "a.md": "---\ntitle: A\ndate: 2026-01-01\n---\n\nCuerpo.\n", "b.md": "---\ntitle: B\ndate: 2026-06-01\n---\n\nCuerpo.\n"} | b.md |
        | {"lista.md": "---\ntitle: Todos\ntype: list\nfilter:\n  keyword: memoria\n---\n", "a.md": "---\ntitle: A\nkeywords: [memoria, cuidado]\n---\n\nCuerpo.\n", "b.md": "---\ntitle: B\nkeywords: [otro]\n---\n\nCuerpo.\n"} | a.md |
        | {"lista.md": "---\ntitle: Todos\ntype: list\nfilter:\n  path: posts/\n---\n", "posts/a.md": "---\ntitle: A\n---\n\nCuerpo.\n", "b.md": "---\ntitle: B\n---\n\nCuerpo.\n"} | posts/a.md |

  Regla de negocio: El orden lo manda la configuración

    Esquema del escenario: Cada orden ordena distinto
      Dado que la raíz del proyecto está vacía
      Y que el proyecto tiene:
      """
      {"lista.md": "---\ntitle: Todos\ntype: list\norder: <orden>\n---\n", "a.md": "---\ntitle: Alfa\ndate: 2026-03-01\ncreator: Zeta\n---\n\nCuerpo.\n", "b.md": "---\ntitle: Beta\ndate: 2026-01-01\ncreator: Ana\n---\n\nCuerpo.\n"}
      """
      Cuando descubro y post-proceso el proyecto
      Entonces los miembros de "lista.md" son "<miembros>"

      Ejemplos:
        | orden | miembros |
        | date-desc | a.md, b.md |
        | date-asc | b.md, a.md |
        | title-asc | a.md, b.md |
        | title-desc | b.md, a.md |
        | creator-asc | b.md, a.md |

  Regla de negocio: El filtro se valida

    Escenario: Un criterio que no existe es error
      Cuando valido el frontmatter de una lista:
      """
      type: list
      filter:
        color: azul
      """
      Entonces algún error de frontmatter menciona "color"

    Escenario: Un orden que no existe es error
      Cuando valido el frontmatter de una lista:
      """
      type: list
      order: al-azar
      """
      Entonces algún error de frontmatter menciona "order"

    Escenario: Un filtro bien escrito no es error
      Cuando valido el frontmatter de una lista:
      """
      type: list
      filter:
        type: file
        creator: Ana
        date:
          from: 2026-01-01
        keyword: memoria
        path: posts/
      order: date-desc
      """
      Entonces ningún error de frontmatter menciona "filter"
      Y ningún error de frontmatter menciona "order"

  Regla de negocio: La lista sólo produce HTML

    Escenario: La lista se construye y no genera PDF, EPUB ni Markdown
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y una lista con 3 textos
      Y el proyecto produce html, markdown y epub
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/todos-los-textos.html" existe
      Y el archivo "dist/files/todos-los-textos.md" no existe
      Y el archivo "dist/files/todos-los-textos.epub" no existe

    Escenario: La página de la lista lleva las tarjetas de sus miembros
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y una lista con 3 textos
      Y el proyecto produce html, markdown y epub
      Cuando hago un build del proyecto
      Entonces el archivo "dist/files/todos-los-textos.html" dice "Texto 1"
      Y el archivo "dist/files/todos-los-textos.html" dice "Tarjeta 1"
