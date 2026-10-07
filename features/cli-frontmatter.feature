# language: es
Característica: El frontmatter del documento gana sobre la configuración

  Como quien escribe un documento en otro idioma dentro de un proyecto en español
  Quiero que el frontmatter del documento mande sobre la configuración del proyecto
  Para no tener que crear un proyecto por cada idioma

  # 9 de los 47 casos que quedan de `cli-layer`.
  #
  # Una sola regla los atraviesa: el frontmatter gana. Y detrás hay una decisión
  # de diseño que vale la pena dejar escrita: cuando el campo existe en la
  # configuración, el frontmatter lo sobreescribe; cuando no existe, el
  # frontmatter lo activa. Por eso `toc` funciona en los dos sentidos.
  #
  # Estos escenarios no compilan LaTeX: leen el `.tex` que genera la plantilla.
  # Compilarlo no es parte de la regla.

  Regla de negocio: El slug del frontmatter decide el nombre del archivo

    Escenario: Un slug manual decide el nombre de la salida
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Dado que el archivo "test.md" tiene este contenido
      """
      ---
      title: Test Document
      slug: mi-url-fija
      ---

      Contenido.
      """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/mi-url-fija.html" existe
      Y el archivo "dist/files/test-document.html" no existe

      # El slug no agrega un alias: deja de existir el nombre derivado del título.
      # Si aparecieran los dos, la URL vieja seguiría sirviendo un documento
      # viejo y nadie sabría cuál es la buena.

  Regla de negocio: El idioma del frontmatter manda en los tres formatos

    # Contrato unificado (#2010): el mismo campo gobierna HTML, EPUB y el export
    # a Markdown. Antes cada formato leía una clave distinta y había que
    # escribir `language`, `lang` y `xml:lang` en el mismo frontmatter.

    Escenario: El idioma del frontmatter sobreescribe el de la configuración
      Dado que la raíz del proyecto tiene un proyecto con los tres formatos ligeros
      Dado que el archivo "test.md" tiene este contenido
      """
      ---
      title: Test Document
      language: en
      ---

      Contenido.
      """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/test-document.html" contiene '<html lang="en"'
      Y el archivo "dist/files/test-document.epub" existe
      Y el archivo "dist/files/test-document.md" existe

    # Y `lang` no es un alias: es un campo que nadie lee. El aviso existe para
    # que el autor sepa que `lang` no hace nada, y no para hacerlo migrar.

    Escenario: El campo lang se avisa como ignorado
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Dado que el archivo "test.md" tiene este contenido
      """
      ---
      title: Test Document
      lang: en
      ---

      Contenido.
      """
      Cuando corro "validate"
      Entonces el comando termina con el código de salida 0
      Y el error dice "campos de frontmatter ignorados por el pipeline: lang"

  Regla de negocio: El frontmatter manda sobre el índice en los dos sentidos

    # La misma clave en los dos sentidos: `toc: true` en el frontmatter activa el
    # índice aunque la configuración no lo pida, y `toc: false` lo desactiva
    # aunque la configuración lo pida. Un proyecto puede tener un índice general y
    # documentos sin índice, o al revés.

    Escenario: El frontmatter activa el índice sin pedirlo en la config
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Dado que el archivo "test.md" tiene este contenido
      """
      ---
      title: Test Document
      toc: true
      ---

      # Sección

      Contenido.
      """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/test-document.html" contiene 'id="TOC"'

    Escenario: El frontmatter desactiva el índice que la config pide
      Dado que la raíz del proyecto tiene un proyecto con índice
      Dado que el archivo "test.md" tiene este contenido
      """
      ---
      title: Test Document
      toc: false
      ---

      # Sección

      Contenido.
      """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/test-document.html" no contiene 'id="TOC"'

  Regla de negocio: La fecha de la portada se decide en tres niveles

    # Tres niveles: raíz de la configuración, `format.pdf.showDate`, y el
    # frontmatter del documento. El más cercano gana. `show-date` con guion en el
    # frontmatter no existe: el nombre del campo es `showDate` en los tres
    # lugares, y un guion medio rompería la lectura de la clave.

    Escenario: showDate false en la config apaga la fecha aunque el doc tenga date
      Dado que la raíz del proyecto tiene un proyecto con LaTeX y sin PDF
      Dado que la raíz del proyecto apaga la fecha desde la config
      Dado que el archivo "test.md" tiene este contenido
      """
      ---
      title: Test Document
      date: 2026-01-01
      ---

      Contenido.
      """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/test-document.tex" contiene '\date{}'
      Y el archivo "dist/files/test-document.tex" no contiene "1 de enero de 2026"

    Escenario: showDate en la raíz de la config enciende la fecha
      Dado que la raíz del proyecto tiene un proyecto con LaTeX y sin PDF
      Dado que la raíz del proyecto enciende la fecha desde la raíz
      Dado que el archivo "test.md" tiene este contenido
      """
      ---
      title: Test Document
      date: 2026-01-01
      ---

      Contenido.
      """
      Cuando hago un build del proyecto
      Entonces el archivo "dist/files/test-document.tex" contiene "1 de enero de 2026"

    Escenario: El showDate del frontmatter gana sobre format.pdf.showDate
      Dado que la raíz del proyecto tiene un proyecto con LaTeX y sin PDF
      Dado que la raíz del proyecto apaga la fecha desde la config
      Dado que el archivo "test.md" tiene este contenido
      """
      ---
      title: Test Document
      date: 2026-01-01
      showDate: true
      ---

      Contenido.
      """
      Cuando hago un build del proyecto
      Entonces el archivo "dist/files/test-document.tex" contiene "1 de enero de 2026"

  Regla de negocio: El número de página del frontmatter gana

    # `\ofoot` para `footer-right`, `\cfoot` para `footer-center`. Si el
    # frontmatter ganara, el `.tex` tiene `\ofoot` y NO tiene `\cfoot`: el
    # `\cfoot` sería el de la config, y `\cfoot` sin `\ofoot` pone el número
    # en el centro.

    Escenario: El pageNumber del frontmatter gana sobre el de la config
      Dado que la raíz del proyecto tiene un proyecto con LaTeX y sin PDF
      Dado que la raíz del proyecto pone el número de página en el pie central
      Dado que el archivo "test.md" tiene este contenido
      """
      ---
      title: Test Document
      pageNumber: footer-right
      ---

      Contenido.
      """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/test-document.tex" contiene '\ofoot*{\pagemark}'
      Y el archivo "dist/files/test-document.tex" no contiene '\cfoot*{\pagemark}'

  Regla de negocio: Un documento sin frontmatter igual produce un título

    # Sin frontmatter no hay error: hay un default. El aviso sale en `validate`,
    # no acá — el build tiene que producir el documento de todos modos.

    Escenario: Un documento sin frontmatter usa el título por defecto
      Dado que la raíz del proyecto tiene un proyecto con LaTeX
      Dado que el archivo "test.md" tiene este contenido
      """
      Contenido sin frontmatter.
      """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/test.tex" contiene '\title{Sin título}'