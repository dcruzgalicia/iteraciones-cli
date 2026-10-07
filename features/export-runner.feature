# language: es
Característica: el markdown exportado

  Como quien edita un texto ya publicado
  Quiero que el markdown que sale de la salida se pueda volver a procesar
  Para que compilarlo dos veces no lo cambie

  Regla de negocio: El frontmatter del origen sobrevive tal cual

    Escenario: El export conserva los campos del origen
      Dado que la raíz del proyecto está vacía
      Y un documento con título, dos autores y fecha
      Cuando exporto el documento a "salida.md"
      Entonces el markdown empieza con el frontmatter
      Y el markdown declara:
        """
        title: Mi título
        - Autor Uno
        - Autor Dos
        date: 2026-08-08
        """
      Y el markdown termina con el cuerpo intacto

    Escenario: El idioma se completa desde la configuración del sitio
      Dado que la raíz del proyecto está vacía
      Y un documento con título, dos autores y fecha
      Cuando exporto el documento a "salida.md"
      Entonces el markdown declara:
        """
        language: es-MX
        """

    Escenario: Re-procesar el export da el mismo archivo
      Dado que la raíz del proyecto está vacía
      Y un documento con título, dos autores y fecha
      Cuando vuelvo a exportar mi propia salida a "salida.md"
      Entonces el markdown es byte-idéntico a su fuente

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