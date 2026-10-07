# language: es
@requires-pandoc
@requires-magick
Característica: Todo lo estático de dist vive dentro de un directorio assets
  Como quien mueve la salida de un build a otra máquina
  Quiero que dist no referencie rutas del proyecto fuente
  Para que el PDF siga compilando y reprocesar los markdowns sea idempotente

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
