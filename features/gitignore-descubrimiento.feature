# language: es
Característica: qué documentos se compilan

  Como quien tiene un proyecto con borradores y notas privadas
  Quiero que el build descubra sólo lo que hay que publicar
  Para no imprimir los borradores

  # Tramo 33 de la migración. 4 de los 6 casos restantes de `gitignore.test.ts`.

  # El descubrimiento comparte una sola lista con `discover`, así que lo que se
  # prueba aquí es exactamente lo que el build va a compilar.

  Regla de negocio: La lista sale ordenada y sin dotfiles

    # Un dotfile es un archivo de trabajo del autor, no un documento. Y el
    # orden tiene que ser estable: si no, el build recompila de más entre
    # corridas porque el conjunto cambió de forma.

    Escenario: La lista excluye dotfiles, ignorados y node_modules
      Dado que la raíz del proyecto está vacía
      Y que el proyecto escribe "borradores/<br>"
      Y que el proyecto tiene directorios:
      """
      posts
      node_modules/x
      borradores
      """
      Y que el proyecto tiene los archivos:
      """
      z.md
      a.md
      posts/b.md
      .oculto.md
      node_modules/x/dep.md
      borradores/draft.md
      """
      Cuando descubro los documentos del proyecto
      # `posts/b.md` con ruta, no `b.md`: la ruta es la identidad del documento.
      Entonces los documentos descubiertos son "a.md, posts/b.md, z.md"

    # Un directorio que empieza por punto está igual de excluido que un
    # archivo: si no, `visible/.oculto/nota.md` se publicaría.
    Escenario: Se excluyen archivos y carpetas con prefijo .
      Dado que la raíz del proyecto está vacía
      Y que el proyecto tiene directorios:
      """
      visible
      visible/.oculto
      """
      Y que el proyecto tiene los archivos:
      """
      normal.md
      .oculto.md
      visible/normal.md
      visible/.privado.md
      visible/.oculto/nota.md
      """
      Cuando descubro con el pipeline completo
      # El pipeline completo es el que usa el build de verdad.
      Entonces los documentos descubiertos son "normal.md, visible/normal.md"

  Regla de negocio: Las reglas de .gitignore se respetan

    # Son las reglas de git, no unas propias: si el proyecto ya trae un
    # `.gitignore`, el autor espera que el build lo entienda igual que git.

    Escenario: Se excluyen los documentos listados en .gitignore
      Dado que la raíz del proyecto está vacía
      Y que el proyecto escribe "AGENTS.md<br>borradores/<br>"
      Y que el proyecto tiene directorios:
      """
      borradores
      """
      Y que el proyecto tiene los archivos:
      """
      normal.md
      AGENTS.md
      borradores/secreto.md
      borradores/interno.md
      """
      Cuando descubro con el pipeline completo
      # Sólo queda el documento publicable.
      Entonces los documentos descubiertos son "normal.md"

    # La negación de git manda sobre el wildcard: si no, no se podría
    # publicar un archivo dentro de una carpeta general.
    Escenario: La negación ! re-incluye un archivo
      Dado que la raíz del proyecto está vacía
      Y que el proyecto escribe "*.md<br>!publicado.md<br>"
      Y que el proyecto tiene los archivos:
      """
      privado.md
      publicado.md
      """
      Cuando descubro con el pipeline completo
      # `*.md` los ignora a los dos y `!publicado.md` deshace el ignore de uno.
      Entonces los documentos descubiertos son "publicado.md"

    # Sin .gitignore no hay reglas: no se excluye nada extra.
    Escenario: Sin .gitignore no se excluye nada adicional
      Dado que la raíz del proyecto está vacía
      Y que el proyecto tiene directorios:
      """
      sub
      """
      Y que el proyecto tiene los archivos:
      """
      a.md
      sub/b.md
      """
      Cuando descubro con el pipeline completo
      Entonces los documentos descubiertos son "a.md, sub/b.md"

    # El matcher sale de las reglas del proyecto, no de las del escenario.
    Escenario: El matcher del proyecto lee su propio .gitignore
      Dado que la raíz del proyecto está vacía
      Y que el proyecto escribe "notas.md<br>"
      # Las reglas se cargan del disco, que es como las ve el build.
      Entonces el matcher del proyecto ignora "notas.md"
