# language: es
@requires-pandoc
Característica: El filtro de rutas de imagen reescribe lo que el preproceso movió
  Como quien tiene imágenes que el preproceso copia a assets
  Quiero que el .tex y el HTML apunten a la copia
  Para que el PDF no se rompa al compilar en otra máquina

  Escenario: Reescribe Image.src en el cuerpo y en la definición de referencia
    Dado un documento con imágenes en el cuerpo, el frontmatter y una referencia
    Y el mapa de rutas del preproceso
    Cuando lo convierto a LaTeX con el filtro de rutas
    Entonces el .tex apunta a las copias de las imágenes
    Y el .tex no conserva ninguna ruta original

  Escenario: Reescribe el img crudo, que llega como RawInline y no como Image
    Dado un documento con imágenes en el cuerpo, el frontmatter y una referencia
    Y el mapa de rutas del preproceso
    Cuando lo convierto a HTML con el filtro de rutas
    Entonces el HTML apunta a la copia de la imagen cruda
    Y el HTML no conserva la ruta original

  Escenario: Reescribe también las rutas del frontmatter
    Dado un documento con imágenes en el cuerpo, el frontmatter y una referencia
    Y el mapa de rutas del preproceso
    Cuando lo convierto a JSON con el filtro de rutas
    Entonces el frontmatter apunta a las copias de la portada y del pie

  Escenario: Sin mapa el documento queda intacto
    Dado un documento con imágenes en el cuerpo, el frontmatter y una referencia
    Cuando lo convierto a LaTeX sin el mapa de rutas
    Entonces el .tex conserva las rutas originales

  Escenario: Con un mapa que no existe falla en vez de emitir rutas viejas
    Dado un documento con imágenes en el cuerpo, el frontmatter y una referencia
    Y un mapa de rutas que no existe
    Cuando lo convierto a LaTeX con un mapa que no existe
    Entonces la conversión falla con un error que nombra el filtro