# language: es
Característica: qué documentos se compilan

  Como quien tiene un proyecto con borradores y notas privadas
  Quiero que el build descubra sólo lo que hay que publicar
  Para no imprimir los borradores

  Regla de negocio: La lista sale ordenada y sin dotfiles

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
      Entonces los documentos descubiertos son "a.md, posts/b.md, z.md"

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
      Entonces los documentos descubiertos son "normal.md, visible/normal.md"

  Regla de negocio: Las reglas de .gitignore se respetan

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
      Entonces los documentos descubiertos son "normal.md"

    Escenario: La negación ! re-incluye un archivo
      Dado que la raíz del proyecto está vacía
      Y que el proyecto escribe "*.md<br>!publicado.md<br>"
      Y que el proyecto tiene los archivos:
      """
      privado.md
      publicado.md
      """
      Cuando descubro con el pipeline completo
      Entonces los documentos descubiertos son "publicado.md"

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

    Escenario: El matcher del proyecto lee su propio .gitignore
      Dado que la raíz del proyecto está vacía
      Y que el proyecto escribe "notas.md<br>"
      Entonces el matcher del proyecto ignora "notas.md"
