Característica: rutas de medios desde la raíz del sitio

  Como quien escribe desde Sveltia con public_folder "/assets/images"
  Quiero que el build resuelva esas rutas desde el documento
  Para que todas las colecciones usen el mismo directorio de medios

  Regla de negocio: /assets/images es una ruta del sitio, no del sistema

    Escenario: Un texto anidado resuelve desde su carpeta
      Cuando normalizo las rutas de imagen de "texts/autora/texto.md" en el proyecto "/proyecto":
      """
      ![a](/assets/images/a.jpg)
      <img src="/assets/images/b.jpg">
      image: /assets/images/c.jpg
      enlace https://ejemplo.com/assets/images/no.jpg
      """
      Entonces el contenido reescrito dice "![a](../../assets/images/a.jpg)"
      Y el contenido reescrito dice "<img src=\"../../assets/images/b.jpg\">"
      Y el contenido reescrito dice "image: ../../assets/images/c.jpg"
      Y el contenido reescrito dice "https://ejemplo.com/assets/images/no.jpg"

    Escenario: Una colección en la raíz resuelve con un nivel
      Cuando normalizo las rutas de imagen de "collections/coleccion.md" en el proyecto "/proyecto":
      """
      ![a](/assets/images/a.jpg)
      """
      Entonces el contenido reescrito dice "![a](../assets/images/a.jpg)"

    Escenario: Un documento en la raíz no sube niveles
      Cuando normalizo las rutas de imagen de "menu.md" en el proyecto "/proyecto":
      """
      ![a](/assets/images/a.jpg)
      """
      Entonces el contenido reescrito dice "![a](assets/images/a.jpg)"
