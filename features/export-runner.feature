# language: es
Característica: el markdown exportado

  Como quien edita un texto ya publicado
  Quiero que el markdown que sale de la salida se pueda volver a procesar
  Para que compilarlo dos veces no lo cambie

  # Tramo 49 de la migración. 4 de los 9 casos de `export-runner.test.ts`.
  # Quedan 5: los EPUB con pandoc real y las compilaciones PDF.

  # El markdown que sale de `dist/files` es un documento que el pipeline puede
  # volver a procesar. Si el frontmatter no sobrevive tal cual, la segunda pasada
  # produce algo distinto y el archivo cambia en cada build sin que nadie lo haya
  # tocado.

  Regla de negocio: El frontmatter del origen sobrevive tal cual

    Escenario: El export conserva los campos del origen
      Dado que la raíz del proyecto está vacía
      Y un documento con título, dos autores y fecha
      Cuando exporto el documento a "salida.md"
      # Los autores en forma de lista, que es como los escribió el autor.
      Entonces el markdown empieza con el frontmatter
      Y el markdown declara:
        """
        title: Mi título
        - Autor Uno
        - Autor Dos
        date: 2026-08-08
        """
      Y el markdown termina con el cuerpo intacto

    # El `language` no venía en el documento: sale de la config del sitio. El
    # export lo completa para que el archivo sea autosuficiente.
    Escenario: El idioma se completa desde la configuración del sitio
      Dado que la raíz del proyecto está vacía
      Y un documento con título, dos autores y fecha
      Cuando exporto el documento a "salida.md"
      # Sin este campo, el re-proceso usaría el idioma por defecto.
      Entonces el markdown declara:
        """
        language: es-MX
        """

    # La fecha va en crudo. Humanizarla rompía la idempotencia: al releer
    # "8 de agosto de 2026" el build ya no reconocía la fecha ISO.
    Escenario: Re-procesar el export da el mismo archivo
      Dado que la raíz del proyecto está vacía
      Y un documento con título, dos autores y fecha
      Cuando vuelvo a exportar mi propia salida a "salida.md"
      # Byte a byte: si cambiara, el archivo se movería en cada build.
      Entonces el markdown es byte-idéntico a su fuente

    # Un campo vacío no se escribe: un `creator:` sin nada debajo confunde a
    # quien lee el archivo.
    Escenario: Sin autores ni fecha los campos no se emiten
      Dado que la raíz del proyecto está vacía
      Y un documento sin autores ni fecha
      Cuando exporto el documento a "salida.md"
      Entonces el markdown NO declara:
        """
        creator:
        date:
        """

  Regla de negocio: El markdown exportado no es LaTeX ni lleva rutas

    # Ni `\documentclass`, ni rutas absolutas, ni `bibliography`/`csl`. Las rutas
    # absolutas rompen en otra máquina; los dos últimos se congelarían con la
    # ruta del proyecto original, porque al re-procesar vienen de la config del
    # sitio y no del documento.

    Escenario: El export no lleva cabecera LaTeX ni rutas absolutas
      Dado que la raíz del proyecto está vacía
      Y un documento con título, dos autores y fecha
      Y un documento con bibliografía y CSL propio
      Cuando exporto el documento a "salida.md"
      Entonces el markdown NO declara:
        """
        documentclass
        bibliography:
        csl:
        """
      Y el markdown no lleva la ruta del proyecto