# language: es
Característica: las imágenes de las páginas de título

  Como quien pone una imagen en la contraportada
  Quiero que se procese y se recoloque
  Para que salga en la imprenta con la misma resolución que el resto

  Regla de negocio: Sólo los campos multilínea llevan imágenes

    Escenario: Una imagen en un campo multilínea se encuentra
      Dado que la raíz del proyecto está vacía
      Y que el proyecto tiene la imagen "Images/logo.jpg"
      Y que el frontmatter declara el campo "lowertitleback" con:
      """
      ![logo](Images/logo.jpg)
      """
      Cuando escaneo las imágenes de los campos de portada
      Entonces el escaneo de portada encuentra 1 imágenes
      Y la imagen 1 de portada es "Images/logo.jpg"
      Y la imagen 1 de portada no es SVG

    Escenario: Una imagen en un campo multilínea en lista se encuentra
      Dado que la raíz del proyecto está vacía
      Y que el proyecto tiene la imagen "Images/logo.jpg"
      Y que el frontmatter declara el campo "lowertitleback" con:
      """
      ["Texto antes", "", "![logo](Images/logo.jpg)"]
      """
      Cuando escaneo las imágenes de los campos de portada
      Entonces el escaneo de portada encuentra 1 imágenes
      Y la imagen 1 de portada es "Images/logo.jpg"

    Escenario: Varios campos con imagen se escanean juntos
      Dado que la raíz del proyecto está vacía
      Y que el proyecto tiene la imagen "Images/logo.jpg"
      Y que el proyecto tiene la imagen "Images/icon.jpg"
      Y que el frontmatter declara el campo "lowertitleback" con:
      """
      ![logo](Images/logo.jpg)
      """
      Y que el frontmatter declara el campo "uppertitleback" con:
      """
      ![icon](Images/icon.jpg)
      """
      Cuando escaneo las imágenes de los campos de portada
      Entonces el escaneo de portada encuentra 2 imágenes

    Escenario: Una URL externa no se descarga
      Dado que la raíz del proyecto está vacía
      Y que el frontmatter declara el campo "lowertitleback" con:
      """
      ![logo](https://example.com/logo.jpg)
      """
      Cuando escaneo las imágenes de los campos de portada
      Entonces el escaneo de portada encuentra 0 imágenes

    Escenario: Una ruta absoluta se ignora
      Dado que la raíz del proyecto está vacía
      Y que el frontmatter declara el campo "lowertitleback" con:
      """
      ![logo](/absolute/path/logo.jpg)
      """
      Cuando escaneo las imágenes de los campos de portada
      Entonces el escaneo de portada encuentra 0 imágenes

    Escenario: Un campo que no es multilínea no se escanea
      Dado que la raíz del proyecto está vacía
      Y que el proyecto tiene la imagen "Images/logo.jpg"
      Y que el frontmatter declara el campo "subject" con:
      """
      ![logo](Images/logo.jpg)
      """
      Cuando escaneo las imágenes de los campos de portada
      Entonces el escaneo de portada encuentra 0 imágenes

    Escenario: Un campo sin imágenes no encuentra nada
      Dado que la raíz del proyecto está vacía
      Y que el frontmatter declara el campo "lowertitleback" con:
      """
      Texto simple sin imágenes
      """
      Cuando escaneo las imágenes de los campos de portada
      Entonces el escaneo de portada encuentra 0 imágenes

  Regla de negocio: Sin ImageMagick se avisa una vez, y sólo si el PDF lo pide

    Escenario: El aviso sale una vez por build, no una por documento
      Dado que la raíz del proyecto está vacía
      Y que el aviso de ImageMagick se da por activo
      Y proceso dos documentos sin ImageMagick
      Entonces el aviso de ImageMagick aparece 1 vez
      Y el aviso menciona la certificación

    Escenario: Sin PDF/X el aviso no menciona la certificación
      Dado que la raíz del proyecto está vacía
      Y que el aviso de ImageMagick se da por inactivo
      Y proceso un documento sin ImageMagick
      Entonces el aviso de ImageMagick aparece 1 vez
      Y el aviso no menciona la certificación

  Regla de negocio: La caja del startpaper es siempre la página completa

    Esquema del escenario: Las cajas de destino según el crop
      Dado que la raíz del proyecto está vacía
      Y que la página es de 140 por 216 con 110 de texto
      Cuando calculo las cajas de destino "<crop>"
      Entonces la caja de destino cabe "<targetW>"
      Y la caja del startpaper cabe "<startW>"

      Ejemplos:
        | crop | targetW | startW |
        | sin crop | 110x216 | 140x216 |
        | con crop | 116x222 | 146x222 |
