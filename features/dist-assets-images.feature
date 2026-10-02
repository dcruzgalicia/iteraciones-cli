# language: es
@requires-pandoc
@requires-magick
Característica: Todo lo estático de dist vive dentro de un directorio assets
  Como quien mueve la salida de un build a otra máquina
  Quiero que dist no referencie rutas del proyecto fuente
  Para que el PDF siga compilando y reprocesar los markdowns sea idempotente

  # #2435/#2450 — las imágenes procesadas viven en
  # `<outputDir>/<nivel>/assets/images/` con nombre `<slug>-<base>`: un único
  # fichero por imagen, sin que se pisen documentos del mismo nivel. El CSS, las
  # fuentes y el logo también viven dentro de `assets/`.
  #
  # #2441 — el frontmatter del markdown exportado trae las tres formas de imagen
  # (escalar, lista y multilínea) y el body trae `![ref][id]` y `<img crudo>`.
  # #2460 — el filtro `semantic/ast/04-image-paths` lee un mapa por documento y
  # formato, con una clave por cada forma de la ruta.
  #
  # El issue pregunta si dividir este caso de 22 aserciones. La respuesta es
  # dividir por COMPORTAMIENTO: seis pasos que se leen como seis reglas del
  # contrato de `assets`, no veintidós `expect`.

  Escenario: Todo lo estático acaba en assets con una sola copia por imagen
    Dado un proyecto con un manuscrito y un anexo anidado, cada uno con sus imágenes
    Y el frontmatter del manuscrito trae las tres formas de imagen
    Cuando compilo el proyecto por el CLI
    Entonces la copia de cada imagen vive en el directorio de imágenes de su nivel
    Y el formato exportado la referencia desde ese directorio
    Y el anexo no sube con dos puntos para llegar a su directorio
    Y el markdown exportado apunta a assets en todas las formas
    Y el mapa de rutas por documento y formato existe
    Y ningún archivo estático queda fuera de un directorio assets
