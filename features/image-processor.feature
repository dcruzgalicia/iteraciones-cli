# language: es
Característica: el reemplazo de rutas de imagen en el markdown

  Como quien tiene imágenes en su markdown y en su frontmatter
  Quiero que apunten al archivo procesado y sólo a él
  Para que el PDF salga con las imágenes en calidad de imprenta sin romper el
  markdown que escribí

  Regla de negocio: El reemplazo va anclado al objetivo de la imagen

    Escenario: Las imágenes markdown se reescriben y las colisiones no
      Dado que la imagen del documento se procesó en "/proyecto/capitulos/.iteraciones/processed-images/img.jpg"
      Cuando reescribo las rutas de imagen del contenido:
      """
      ![portada](img.png)
      ver ![otra](./img.png) también
      la referencia ![b](img.png.bak) no se toca
      el texto suelto "img.png" tampoco
      `code con img.png dentro` intacto
      """
      Entonces el contenido reescrito dice "![portada](/proyecto/capitulos/.iteraciones/processed-images/img.jpg)"
      Y el contenido reescrito dice "![otra](/proyecto/capitulos/.iteraciones/processed-images/img.jpg)"
      Y el contenido reescrito dice "la referencia ![b](img.png.bak) no se toca"
      Y el contenido reescrito dice "el texto suelto \"img.png\" tampoco"
      Y el contenido reescrito dice "`code con img.png dentro` intacto"

    Escenario: Las cuatro formas de apuntar a una imagen se reescriben
      Dado que la imagen del documento se procesó en "/proyecto/capitulos/.iteraciones/processed-images/img.jpg"
      Cuando reescribo las rutas de imagen del contenido:
      """
      portada:
        - img.png
        - './img.png'
      [r]: img.png
      <img src="img.png" alt="x">
      en prosa "img.png" no se toca
      """
      Entonces el contenido reescrito dice "  - /proyecto/capitulos/.iteraciones/processed-images/img.jpg"
      Y el contenido reescrito dice "[r]: /proyecto/capitulos/.iteraciones/processed-images/img.jpg"
      Y el contenido reescrito dice "<img src=\"/proyecto/capitulos/.iteraciones/processed-images/img.jpg\" alt=\"x\">"
      Y el contenido reescrito dice "en prosa \"img.png\" no se toca"

    Escenario: El frontmatter de portada conserva sus comillas
      Dado que la imagen del documento se procesó en "/proyecto/capitulos/.iteraciones/processed-images/img.jpg"
      Cuando reescribo las rutas de imagen del contenido:
      """
      ---
      titleImage: "img.png"
      publisherImage: 'img.png'
      startpaper: img.png
      otra-clave: img.png
      ---
      """
      Entonces el contenido reescrito dice "titleImage: \"/proyecto/capitulos/.iteraciones/processed-images/img.jpg\""
      Y el contenido reescrito dice "publisherImage: '/proyecto/capitulos/.iteraciones/processed-images/img.jpg'"
      Y el contenido reescrito dice "startpaper: /proyecto/capitulos/.iteraciones/processed-images/img.jpg"
      Y el contenido reescrito dice "otra-clave: img.png"

    Escenario: Una imagen fuera del directorio del documento se resuelve igual
      Dado que hay una imagen procesada fuera del directorio del documento
      Cuando reescribo las rutas de imagen del contenido:
      """
      ![x](../comun/x.png)
      """
      Entonces el contenido reescrito es:
      """
      ![x](/salida/assets/images/cap-x.jpg)
      """

    Escenario: Sin imágenes procesadas el contenido queda intacto
      Dado que el mapa de imágenes está vacío
      Cuando reescribo las rutas de imagen del contenido:
      """
      ![a](img.png)
      """
      Entonces el contenido reescrito es:
      """
      ![a](img.png)
      """

  Regla de negocio: Cada formato expone las rutas como las escribe

    Escenario: LaTeX y EPUB reciben la ruta absoluta en las tres formas
      Dado que la imagen del documento se procesó en "/proyecto/capitulos/.iteraciones/processed-images/cap-img.jpg"
      Y que hay una imagen que no se procesó
      Cuando expongo el mapa de rutas para "latex"
      Entonces la ruta "/proyecto/capitulos/img.png" vale "/proyecto/capitulos/.iteraciones/processed-images/img.jpg"
      Y la ruta "img.png" vale "/proyecto/capitulos/.iteraciones/processed-images/img.jpg"
      Y la ruta "./img.png" vale "/proyecto/capitulos/.iteraciones/processed-images/img.jpg"

    Escenario: La imagen que no se procesó no entra en el mapa
      Dado que sólo hay una imagen que no se procesó
      Cuando expongo el mapa de rutas para "latex"
      Entonces el mapa de rutas está vacío

    Escenario: La HTML recibe la ruta de sus assets
      Dado que la imagen del documento se procesó en "/proyecto/capitulos/.iteraciones/processed-images/cap-img.jpg"
      Cuando expongo el mapa de rutas para "html"
      Entonces la ruta "/proyecto/capitulos/img.png" vale "./assets/images/cap-img.jpg"
      Y la ruta "img.png" vale "./assets/images/cap-img.jpg"
      Y la ruta "./img.png" vale "./assets/images/cap-img.jpg"

  Regla de negocio: El nombre de salida lleva el slug del documento

    Escenario: El nombre lleva el slug y las colisiones se numeran
      Cuando nombro las imágenes con el prefijo "ejemplo"
      Cuando nombro la imagen "/proy/foto.png"
      Entonces el nombre es "ejemplo-foto.jpg"
      Cuando nombro la imagen "/proy/foto.png"
      Entonces el nombre es "ejemplo-foto.jpg"
      Cuando nombro la imagen "/proy/otra/foto.png"
      Entonces el nombre es "ejemplo-foto-2.jpg"
      Cuando nombro la imagen "/proy/tercera/foto.jpeg"
      Entonces el nombre es "ejemplo-foto-3.jpg"
      Cuando nombro la imagen "/proy/foto.png"
      Entonces el nombre es "ejemplo-foto.jpg"

    Escenario: Cada documento nombra con su propio prefijo
      Cuando nombro las imágenes con el prefijo "uno"
      Cuando nombro la imagen "/proy/foto.png"
      Entonces el nombre es "uno-foto.jpg"

    Esquema del escenario: El prefijo no se acumula sobre un nombre que ya lo lleva
      Cuando nombro las imágenes con el prefijo "<prefijo>"
      Cuando nombro la imagen "<origen>"
      Entonces el nombre es "<esperado>"

      Ejemplos:
        | prefijo | origen | esperado |
        | ejemplo | /copia/assets/images/ejemplo-foto.jpg | ejemplo-foto.jpg |
        | ejemplo | /copia/assets/images/ejemplo-foto-2.jpg | ejemplo-foto-2.jpg |
        | ejemplo | /copia3/assets/images/ejemplo-foto.jpg | ejemplo-foto.jpg |
        | otro | /copia/assets/images/ejemplo-foto.jpg | otro-ejemplo-foto.jpg |

    Escenario: Sin slug el nombre no lleva prefijo
      Cuando nombro las imágenes con el prefijo ""
      Cuando nombro la imagen "/proy/portada.png"
      Entonces el nombre es "portada.jpg"

  Regla de negocio: El escaneo ve las cuatro formas y descarta las otras

    Escenario: El escaneo detecta las tres sintaxis y descarta el resto
      Cuando escaneo las imágenes en línea de:
      """
      ![a](img.png)
      ![b][ref]
      [ref]: portada.png
      [nota]: ver.md
      <img src="html.jpg" alt="x">
      <img src="https://ejemplo.com/ext.png">
      <img src="data:image/png;base64,xxx">
      """
      Entonces las imágenes en línea son "/proyecto/capitulos/img.png, /proyecto/capitulos/portada.png, /proyecto/capitulos/html.jpg"