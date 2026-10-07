# language: es
Característica: las reglas de `.gitignore` deciding qué se compila

  Como quien tiene notas de trabajo en el repositorio
  Quiero que `.gitignore` decida qué documentos se compilan
  Para no subir a la imprenta mis notas ni el directorio de compilación

  # Tramo 27 de la migración. 11 de los 17 casos de `gitignore.test.ts`.
  # Los que discover sobre un proyecto real se quedan.

  # Estas reglas son las de git, no unas propias: si el proyecto ya trae un
  # `.gitignore`, el autor espera que el build lo entienda igual que git. Por
  # eso los wildcards, la negación y el anclaje se comportan como en git, y los
  # tests los fijan con la semántica de git.

  Regla de negocio: Los wildcards funcionan como en git

    Esquema del escenario: Un patrón con wildcards
      Dado que la raíz del proyecto está vacía
      Y que el .gitignore dice:
      """
      <reglas>
      """
      Entonces el archivo "<ruta>" <resultado> por las reglas

      Ejemplos:
        | reglas | ruta | resultado |
        | doc?.md | doc1.md | "queda ignorado" |
        | doc?.md | doc12.md | "no queda ignorado" |
        | doc?.md | doc.md | "no queda ignorado" |
        | [abc].md | a.md | "queda ignorado" |
        | [abc].md | c.md | "queda ignorado" |
        | [abc].md | d.md | "no queda ignorado" |
        | *.tmp.md | a.tmp.md | "queda ignorado" |
        | *.tmp.md | x/y.tmp.md | "queda ignorado" |
        | **/privado/*.md | carpeta/privado/nota.md | "queda ignorado" |
        | **/privado/*.md | nota.md | "no queda ignorado" |

    Esquema del escenario: Un patrón anclado
      Dado que la raíz del proyecto está vacía
      Y que el .gitignore dice:
      """
      <reglas>
      """
      Entonces el archivo "<ruta>" <resultado> por las reglas

      Ejemplos:
        | reglas | ruta | resultado |
        | /docs/privado.md | docs/privado.md | "queda ignorado" |
        | /docs/privado.md | sub/docs/privado.md | "no queda ignorado" |
