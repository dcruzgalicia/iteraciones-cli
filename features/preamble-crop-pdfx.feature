# language: es
Característica: el crop y el PDF/X-1a del papel

  Como quien imprime en una imprenta
  Quiero que el PDF lleve las marcas de corte y la certificación
  Para que el papel se corte bien y el PDF valide en PDF/X-1a

  # Tramo 23 de la migración. 15 de los 17 casos que quedaban de
  # `preamble.test.ts`.

  # Los filtros van en un DSL `nombre|contenido` separado por `;;`, y no en
  # JSON: el JSON necesita escapar las barras del LaTeX, y en un docstring
  # cada herramienta desescapa una vez distinta. Con `|` y `;;` no hay nada
  # que escapar.

  Regla de negocio: El tamaño del papel se detecta de la geometry

    # `geometry` manda sobre `documentclass`: el autor que pone los márgenes
    # a mano no quiere que el papel lo sobrescriba. Y sin ninguna definición
    # cae a letter, que es el papel de carta.

    Esquema del escenario: El tamaño del papel sale de la geometry
      Dado que la raíz del proyecto está vacía
      Dado que el proyecto tiene los filtros:
      """
      <filtros>
      """
      Cuando detecto el tamaño del papel
      Entonces el papel mide <w> por <h> con <textW> de texto

      Ejemplos:
        | filtros | w | h | textW |
        | 01-documentclass \documentclass[paper=letter]{scrbook} ;; 04-margins \usepackage[paperwidth=200mm,paperheight=260mm]{geometry} | 200 | 260 | 149 |
        | 01-documentclass \documentclass[paper=a4]{scrbook} ;; 04-margins \usepackage[top=2.54cm]{geometry} | 210 | 297 | 159 |
        | 01-documentclass \documentclass{scrbook} | 215 | 279 | 165 |
        | 01-documentclass \documentclass[paper=a4]{scrbook} ;; 04-margins \usepackage[paperwidth=148mm,paperheight=210mm]{geometry} | 148 | 210 | 97 |
