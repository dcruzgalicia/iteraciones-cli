# language: es
Característica: el nombre del archivo de salida

  Como quien descarga su PDF
  Quiero que el archivo se llame a partir del título y del autor
  Para reconocerlo en mi carpeta de descargas sin abrirlo

  # Tramo 7 de la migración. 21 de los 38 casos de `discover.test.ts`.

  Regla de negocio: El nombre del archivo se arma con título y primer autor

    # El nombre es lo primero que el autor ve de su trabajo, y lo que decide
    # si dos archivos se pisan en una carpeta. Sin acentos, con guiones, y
    # sólo el primer autor: con tres, el nombre deja de ser legible y la URL
    # deja de ser estable.

    Esquema del escenario: El nombre del archivo sale del título y del autor
      Dado que el documento se titula "<titulo>"
      Y que el documento tiene de autor "<autor>"
      Cuando calculo el nombre del archivo de salida
      Entonces el nombre de salida es "<nombre>"

      Ejemplos:
        | titulo | autor | nombre |
        | Mi Artículo de Prueba | | mi-articulo-de-prueba |
        | Mi Artículo | Juan Pérez | mi-articulo-por-juan-perez |
        | Mi Artículo | Sofia García, Juan Pérez, Ana López | mi-articulo-por-sofia-garcia |

    # La normalización no es estética: `Acentos` y `Acentos` tienen que dar el
    # mismo archivo, o el build produce dos PDFs del mismo documento.
    Esquema del escenario: El nombre normaliza lo que el autor escribió
      Dado que el documento se titula "<titulo>"
      Cuando calculo el nombre del archivo de salida
      Entonces el nombre de salida es "<nombre>"

      Ejemplos:
        | titulo                | nombre                 | porque                                   |
        | Canción para José     | cancion-para-jose      | los acentos no se filtran al nombre       |
        | Diseño & Desarrollo   | diseno-y-desarrollo     | el ampersand se lee "y" en español       |
        | Resultados 100%       | resultados-100-por-ciento | el símbolo se lee completo              |
        |   Hola!!!   Mundo...  | hola-mundo             | los signos y los espacios sueltos se van |

    # Un documento sin título se tiene que llamar ALGO. El nombre del archivo
    # es la última salida: sin ella, el autor no tiene con qué abrir el PDF.
    Esquema del escenario: Sin título, el nombre sale del archivo
      Dado que el documento no tiene título
      Y que el documento viene del archivo "<ruta>"
      Y que el documento tiene de autor "<autor>"
      Cuando calculo el nombre del archivo de salida
      Entonces el nombre de salida es "<nombre>"

      Ejemplos:
        | ruta                  | autor      | nombre                        |
        | posts/mi-articulo.md  |            | mi-articulo                   |
        | notas/apuntes.md      | Juan Pérez | apuntes-por-juan-perez        |
        | sub/documento.md      |            | documento                     |

    Escenario: Un título vacío con archivo de reserva también tiene nombre
      Dado que el documento se titula ""
      Y que el documento viene del archivo "sub/documento.md"
      Cuando calculo el nombre del archivo de salida
      # Con el archivo de reserva siempre hay nombre. Un `title: ""` es un
      # frontmatter mal puesto, no una razón para no generar salida.
      Entonces el nombre de salida es "documento"

    Escenario: Sin título ni archivo de reserva no hay nombre
      Dado que el documento no tiene título
      Cuando calculo el nombre del archivo de salida
      Entonces el nombre de salida no existe

    Escenario: Una lista de autores vacía deja el nombre sin sufijo
      Dado que el documento se titula "Test"
      Y que el documento tiene de autor ""
      Cuando calculo el nombre del archivo de salida
      # Un sufijo "-por-" sin nombre detrás produce `test-por-`, que no lo
      # arregla nadie después.
      Entonces el nombre de salida es "test"

  Regla de negocio: El index.md de cualquier nivel se llama index

    # Es la URL del home. Un subdirectorio con su propio index produce su
    # propio home, y llamarlo por su título rompería el enlace del padre.

    Esquema del escenario: Un index.md produce el nombre index
      Dado que el archivo del documento es "<ruta>"
      Y que el nombre ya calculado es "<nombre>"
      Cuando calculo el nombre del HTML
      Entonces el nombre de salida es "<esperado>"

      Ejemplos:
        | ruta | nombre | esperado |
        | index.md | mi-titulo-por-autor | index |
        | posts/index.md | mi-titulo-por-autor | index |
        | posts/mi-articulo.md | mi-articulo-por-autor | mi-articulo-por-autor |

    # Sin nombre calculado —un documento que el index no conoce— el nombre sale
    # del archivo. Es la red de seguridad: siempre hay nombre.
    Esquema del escenario: Sin nombre calculado, el del archivo
      Dado que el archivo del documento es "<ruta>"
      Y que no hay nombre calculado
      Cuando calculo el nombre del HTML
      Entonces el nombre de salida es "<esperado>"

      Ejemplos:
        | ruta | esperado |
        | posts/nota.md | nota |
        | index.md | index |

  Regla de negocio: El autor del frontmatter es una lista, lo venga como venga

    # El `creator` del frontmatter se puede escribir como texto suelto o como
    # lista, y los dos llegan al index. El que llega con un número en medio
    # —un YAML mal puesto— no puede hacer que el nombre del archivo reviente.

    Esquema del escenario: El autor se separa en una lista
      Dado que el frontmatter declara el autor como:
      """
      <declarado>
      """
      Cuando separo el autor en una lista
      Entonces la lista de autores es "<esperada>"

      Ejemplos:
        | declarado | esperada |
        | "Sofia García" | Sofia García |
        | ["Sofia García"] | Sofia García |
        | ["Sofia García", "Juan Pérez"] | Sofia García, Juan Pérez |
        | ["Sofia", 123, "Juan"] | Sofia, Juan |

    # Un autor ausente o vacío es el caso normal de un documento sin firma, no
    # un error: el documento se genera igual, sólo que sin credencial.
    Esquema del escenario: Sin autor, la lista está vacía
      Dado que el frontmatter declara el autor como:
      """
      <declarado>
      """
      Cuando separo el autor en una lista
      Entonces la lista de autores está vacía

      Ejemplos:
        | declarado |
        | "" |
        | null |
        | [] |

  Regla de negocio: El índice del build arma un documento por archivo

    Escenario: Cada entrada del índice produce su documento
      Dado que la raíz del proyecto está vacía
      Cuando construyo los documentos desde el índice:
      """
      {"a.md": {"title": "Artículo A", "creator": ["Autor1"]},
       "b.md": {"title": "Artículo B", "creator": ["Autor2"]}}
      """
      Entonces hay 2 documentos
      Y el documento 1 está en "a.md"
      Y el documento 1 tiene el título "Artículo A"
      Y el documento 1 tiene de autor "Autor1"
      Y el documento 2 está en "b.md"
      Y el documento 2 tiene el título "Artículo B"

    # Un archivo que el index no conoce sale con los valores por defecto. El
    # build no puede dejar un documento sin título: el nombre del archivo y la
    # portada lo necesitan aunque el autor no escribiera nada.
    Escenario: Un documento sin entrada en el índice trae los valores por defecto
      Dado que la raíz del proyecto está vacía
      Y que el índice tiene una entrada para "x.md"
            Cuando construyo los documentos desde el índice
      Entonces el documento 1 tiene el título "Sin título"
      Y el documento 1 no tiene autor
      Y el documento 1 tiene la fecha ""

    Escenario: El documento se lee de la ruta absoluta de la raíz
      Dado que la raíz del proyecto está vacía
      Y que el índice tiene una entrada para "sub/documento.md"
      Y que la raíz del proyecto es "/raiz"
      Cuando construyo los documentos desde el índice
      Entonces el documento 1 se lee de "/raiz/sub/documento.md"