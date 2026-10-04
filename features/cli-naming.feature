# language: es
Característica: index.md se llama index en todos los formatos

  Como quien tiene la portada del sitio
  Quiero que `index.md` produzca `index.html` y no `inicio.html`
  Para que la URL del home no dependa de cómo titulé el documento

  # Tramo 2 de la migración. 1 de los 17 casos que quedaban de `cli-layer`.

  Regla de negocio: El home se llama index en todos los formatos

    # Un `index.md` cuyo título es "Inicio" tiene dos nombres posibles: `index`
    # y `inicio`. Con los dos, el documento aparece dos veces en la salida y el
    # usuario no sabe cuál es el bueno.

    @requires-pandoc
    @requires-latex
    @requires-unzip
    Escenario: index.md genera index.* y ningún inicio.*
      Dado que la raíz del proyecto tiene un proyecto con todos los formatos
      Dado que el archivo "index.md" tiene este contenido
      """
      ---
      title: Inicio
      date: 2026-01-01
      ---

      Inicio.
      """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el build genera index en todos los formatos
