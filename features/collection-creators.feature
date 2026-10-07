# language: es
Característica: los créditos de una colección

  Como quien publica una antología
  Quiero que la portada nombre a quienes escribieron y a la casa editorial
  Para que el lector sepa quién firma cada parte

  # Tramo 28 de la migración. 13 de los 17 casos de `collection-creators.test.ts`.

  # Son dos preguntas distintas y el proyecto las separa:
  # quién **escribió** (los miembros, agregados y ordenados alfabéticamente,
  # porque el orden de `files[]` no significa nada para el lector) y quién
  # **edita** (`collectionCreator`, que es una casa editorial). El `slug` usa
  # el segundo y la firma del PDF el primero.

  Regla de negocio: El crédito de una colección es la unión de sus miembros

    # Sin autor se pone "Anónima", no se deja vacío: un hueco en la lista de
    # autores de la portada se lee como un bug. Y un archivo que no existe no
    # aporta una "Anónima" que no corresponde a nadie.

    Esquema del escenario: El crédito agregado de los miembros
      Dado que la raíz del proyecto está vacía
      Y que el proyecto tiene:
      """
      <documentos>
      """
      Cuando descubro y post-proceso el proyecto
      Entonces el crédito agregado de "collection.md" es "<credito>"

      Ejemplos:
        | documentos | credito |
        | {"collection.md": "---\ntitle: Antología\ntype: collection\nfiles:\n  - ./child-a.md\n  - ./child-b.md\n---\n", "child-a.md": "---\ntitle: Texto A\ncreator: Luis Pérez\n---\n\nContenido A", "child-b.md": "---\ntitle: Texto B\ncreator: Ana García\n---\n\nContenido B"} | Ana García, Luis Pérez |
        | {"collection.md": "---\ntitle: Antología\ntype: collection\nfiles:\n  - ./a.md\n  - ./b.md\n---\n", "a.md": "---\ntitle: A\ncreator: María López\n---\n\nContenido", "b.md": "---\ntitle: B\ncreator: María López\n---\n\nContenido"} | María López |
        | {"collection.md": "---\ntitle: Antología\ntype: collection\nfiles:\n  - ./a.md\n---\n", "a.md": "---\ntitle: A\ncreator: [Ana García, Luis Pérez, María López]\n---\n\nContenido"} | Ana García, Luis Pérez, María López |
        | {"collection.md": "---\ntitle: Antología\ntype: collection\nfiles:\n  - ./a.md\n---\n", "a.md": "---\ntitle: A\n---\n\nContenido"} | Anónima |
        | {"collection.md": "---\ntitle: Antología\ntype: collection\nfiles:\n  - ./a.md\n  - ./b.md\n---\n", "a.md": "---\ntitle: A\n---\n\nContenido", "b.md": "---\ntitle: B\n---\n\nContenido"} | Anónimas |
        | {"collection.md": "---\ntitle: Antología\ntype: collection\nfiles:\n  - ./a.md\n  - ./no-existe.md\n---\n", "a.md": "---\ntitle: A\ncreator: Autor X\n---\n\nContenido"} | Autor X |
        | {"collection.md": "---\ntitle: Antología\ntype: collection\nfiles:\n  - ./a.md\n  - ./b.md\n  - ./c.md\n---\n", "a.md": "---\ntitle: A\ncreator: Luis Pérez\n---\n\nContenido", "b.md": "---\ntitle: B\n---\n\nContenido sin creator", "c.md": "---\ntitle: C\ncreator: Ana García\n---\n\nContenido"} | Ana García, Anónima, Luis Pérez |

  Regla de negocio: El `collectionCreator` es el crédito editorial

    # El nombre del archivo lo elige la editora, no la lista de autores: por eso
    # el slug usa el `collectionCreator` y la firma del PDF usa los agregados.

    Escenario: El slug usa la editora y la firma usa a los miembros
      Dado que la raíz del proyecto está vacía
      Y que el proyecto tiene:
      """
      {"collection.md": "---\ntitle: Antología\ncollectionCreator: Editora Principal\ntype: collection\nfiles:\n  - ./a.md\n  - ./b.md\n---\n", "a.md": "---\ntitle: A\ncreator: Autora Alpha\n---\n\nContenido", "b.md": "---\ntitle: B\ncreator: Autora Beta\n---\n\nContenido"}
      """
      Cuando descubro y post-proceso el proyecto
      # El nombre del archivo lo elige la editora; la firma acredita a quienes
      # escribieron. Son dos preguntas y da respuestas distintas.
      Entonces el slug de la colección "collection.md" es "antologia-por-editora-principal"
      Y el crédito agregado de "collection.md" es "Autora Alpha, Autora Beta"

    # El `collectionCreator` se conserva en el frontmatter: es un campo que el
    # autor escribió y el post-proceso no borra.
    Escenario: El collectionCreator se conserva en el frontmatter
      Dado que la raíz del proyecto está vacía
      Y que el proyecto tiene:
      """
      {"collection.md": "---\ntitle: Antología\ncollectionCreator: Editora Principal\ntype: collection\nfiles:\n  - ./a.md\n---\n", "a.md": "---\ntitle: A\n---\n\nContenido"}
      """
      Cuando descubro y post-proceso el proyecto
      Entonces el collectionCreator de "collection.md" es "Editora Principal"

    # Sin `collectionCreator` no se inventa uno a partir de los autores: el
    # slug tendría un "-por-" con un nombre que la editora no eligió.
    Escenario: Sin collectionCreator no se inventa
      Dado que la raíz del proyecto está vacía
      Y que el proyecto tiene:
      """
      {"collection.md": "---\ntitle: Antología\ntype: collection\nfiles:\n  - ./a.md\n---\n", "a.md": "---\ntitle: A\ncreator: Autora\n---\n\nContenido"}
      """
      Cuando descubro y post-proceso el proyecto
      Entonces el collectionCreator de "collection.md" no está
  # --- Tramo 33: los 4 casos que quedaban de `collection-creators.test.ts` ---

  Regla de negocio: Varias editoras: el slug usa la primera

    # El nombre del archivo lo elige la editora, así que el slug sale del
    # `collectionCreator` declarado y no de los autores de los miembros. Y los
    # autores agregados van ordenados alfabéticamente porque el orden de
    # `files[]` no significa nada para el lector.

    Escenario: Con varias editoras el slug usa la primera y la firma las une
      Dado que la raíz del proyecto está vacía
      Y que el proyecto tiene:
      """
      {"collection.md": "---\ntitle: Antología\ncollectionCreator: [Editora Alpha, Editora Beta]\ntype: collection\nfiles:\n  - ./a.md\n  - ./b.md\n---\n", "a.md": "---\ntitle: A\ncreator: Autora Gamma\n---\n\nContenido", "b.md": "---\ntitle: B\ncreator: Autora Delta\n---\n\nContenido"}
      """
      Cuando descubro y post-proceso el proyecto
      # Gamma y Delta, ordenados: Delta Gamma, no Gamma Delta.
      Entonces el slug de la colección "collection.md" es "antologia-por-editora-alpha"
      Y el crédito agregado de "collection.md" es "Autora Delta, Autora Gamma"
      Y el collectionCreator de "collection.md" es "Editora Alpha,Editora Beta"

  Regla de negocio: `creator` no vale para una colección (#2446)

    # El error dice cuál es el campo correcto: un mensaje que sólo dice
    # "creator no es válido aquí" deja al autor a buscar el nombre bueno.

    Escenario: creator en una colección es error de build con el fix
      Dado que la raíz del proyecto está vacía
      Y que el proyecto tiene:
      """
      {"collection.md": "---\ntitle: Antología\ncreator: Editora Principal\ntype: collection\nfiles:\n  - ./a.md\n---\n", "a.md": "---\ntitle: A\n---\n\nContenido"}
      """
      Cuando construyo el proyecto entero
      # El mensaje nombra `collectionCreator`.
      Entonces la construcción falla diciendo "collectionCreator"

    # `collectionCreator` es un campo conocido: no da error NI aviso. Si
    # apareciera en la lista de desconocidos, el autor vería un aviso
    # fantasma por usar el campo que le dijimos que usara.
    Escenario: collectionCreator es campo conocido, sin error ni aviso
      Dado que la raíz del proyecto está vacía
      Cuando valido el frontmatter crudo:
      """
      title=Antología
      type=collection
      collectionCreator=Editora Principal
      files=a.md
      """
      Entonces ningún error menciona "collectionCreator"

    # Fuera de las colecciones `creator` sigue siendo el campo bueno.
    Escenario: creator sigue admitido fuera de las colecciones
      Dado que la raíz del proyecto está vacía
      Cuando valido el frontmatter crudo:
      """
      title=Documento
      creator=Autora
      """
      Entonces ningún error menciona "creator"
