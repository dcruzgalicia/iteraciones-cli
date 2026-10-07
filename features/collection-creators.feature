# language: es
Característica: los créditos de una colección

  Como quien publica una antología
  Quiero que la portada nombre a quienes escribieron y a la casa editorial
  Para que el lector sepa quién firma cada parte

  Regla de negocio: El crédito de una colección es la unión de sus miembros

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

    Escenario: El slug usa la editora y la firma usa a los miembros
      Dado que la raíz del proyecto está vacía
      Y que el proyecto tiene:
      """
      {"collection.md": "---\ntitle: Antología\ncollectionCreator: Editora Principal\ntype: collection\nfiles:\n  - ./a.md\n  - ./b.md\n---\n", "a.md": "---\ntitle: A\ncreator: Autora Alpha\n---\n\nContenido", "b.md": "---\ntitle: B\ncreator: Autora Beta\n---\n\nContenido"}
      """
      Cuando descubro y post-proceso el proyecto
      Entonces el slug de la colección "collection.md" es "antologia-por-editora-principal"
      Y el crédito agregado de "collection.md" es "Autora Alpha, Autora Beta"

    Escenario: El collectionCreator se conserva en el frontmatter
      Dado que la raíz del proyecto está vacía
      Y que el proyecto tiene:
      """
      {"collection.md": "---\ntitle: Antología\ncollectionCreator: Editora Principal\ntype: collection\nfiles:\n  - ./a.md\n---\n", "a.md": "---\ntitle: A\n---\n\nContenido"}
      """
      Cuando descubro y post-proceso el proyecto
      Entonces el collectionCreator de "collection.md" es "Editora Principal"

    Escenario: Sin collectionCreator no se inventa
      Dado que la raíz del proyecto está vacía
      Y que el proyecto tiene:
      """
      {"collection.md": "---\ntitle: Antología\ntype: collection\nfiles:\n  - ./a.md\n---\n", "a.md": "---\ntitle: A\ncreator: Autora\n---\n\nContenido"}
      """
      Cuando descubro y post-proceso el proyecto
      Entonces el collectionCreator de "collection.md" no está

  Regla de negocio: Varias editoras: el slug usa la primera

    Escenario: Con varias editoras el slug usa la primera y la firma las une
      Dado que la raíz del proyecto está vacía
      Y que el proyecto tiene:
      """
      {"collection.md": "---\ntitle: Antología\ncollectionCreator: [Editora Alpha, Editora Beta]\ntype: collection\nfiles:\n  - ./a.md\n  - ./b.md\n---\n", "a.md": "---\ntitle: A\ncreator: Autora Gamma\n---\n\nContenido", "b.md": "---\ntitle: B\ncreator: Autora Delta\n---\n\nContenido"}
      """
      Cuando descubro y post-proceso el proyecto
      Entonces el slug de la colección "collection.md" es "antologia-por-editora-alpha"
      Y el crédito agregado de "collection.md" es "Autora Delta, Autora Gamma"
      Y el collectionCreator de "collection.md" es "Editora Alpha,Editora Beta"

  Regla de negocio: `creator` no vale para una colección (#2446)

    Escenario: creator en una colección es error de build con el fix
      Dado que la raíz del proyecto está vacía
      Y que el proyecto tiene:
      """
      {"collection.md": "---\ntitle: Antología\ncreator: Editora Principal\ntype: collection\nfiles:\n  - ./a.md\n---\n", "a.md": "---\ntitle: A\n---\n\nContenido"}
      """
      Cuando construyo el proyecto entero
      Entonces la construcción falla diciendo "collectionCreator"

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

    Escenario: creator sigue admitido fuera de las colecciones
      Dado que la raíz del proyecto está vacía
      Cuando valido el frontmatter crudo:
      """
      title=Documento
      creator=Autora
      """
      Entonces ningún error menciona "creator"
