# language: es
Característica: columnas del grid por breakpoint

  Para que las tarjetas y el contenido no se aprieten en ningún ancho
  Quiero columnas explícitas en cada breakpoint

  Escenario: El grid de contenido cambia de 1 a 4 columnas
    Cuando leo las utilidades de grid
    Entonces content-grid usa 1 columna base
    Y content-grid usa 2 columnas en sm
    Y content-grid usa 2 columnas en md
    Y content-grid usa 3 columnas en lg
    Y content-grid usa 3 columnas en xl
    Y content-grid usa 4 columnas en 2xl

  Escenario: Los previews cambian de 1 a 3 columnas
    Cuando leo las utilidades de grid
    Entonces preview-grid usa 1 columna base
    Y preview-grid usa 2 columnas en sm
    Y preview-grid usa 1 columna en md
    Y preview-grid usa 2 columnas en lg
    Y preview-grid usa 3 columnas en xl
    Y preview-grid usa 3 columnas en 2xl

  Escenario: Las publicaciones de creadora llegan a tres columnas
    Cuando leo las utilidades de grid
    Entonces creator-publications-grid usa 1 columna base
    Y creator-publications-grid usa 2 columnas en lg
    Y creator-publications-grid usa 3 columnas en xl
    Y creator-publications-grid usa 3 columnas en 2xl
