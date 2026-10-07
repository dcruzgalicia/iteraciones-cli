# language: es
Característica: index.md se llama index en todos los formatos

  Como quien tiene la portada del sitio
  Quiero que `index.md` produzca `index.html` y no `inicio.html`
  Para que la URL del home no dependa de cómo titulé el documento

  Regla de negocio: El home se llama index en todos los formatos

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
