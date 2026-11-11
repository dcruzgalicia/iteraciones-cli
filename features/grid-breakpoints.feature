# language: es
Característica: columnas del grid por breakpoint

  Para que las tarjetas no se aprieten en ningún ancho
  Quiero columnas explícitas en cada breakpoint

  Escenario: El grid de tarjetas cambia de 1 a 3 columnas
    Cuando leo las utilidades de grid
    Entonces collection-grid usa 1 columna base
    Y collection-grid usa 2 columnas en sm
    Y collection-grid usa 1 columna en md
    Y collection-grid usa 2 columnas en lg
    Y collection-grid usa 2 columnas en xl
    Y collection-grid usa 3 columnas en 2xl

  Escenario: El grid principal nunca pasa de 2 columnas
    Cuando leo las utilidades de grid
    Entonces main-grid usa 1 columna base
    Y main-grid usa 2 columnas en sm
    Y main-grid usa 1 columna en md
    Y main-grid usa 2 columnas en lg
    Y main-grid no define 3 columnas en 2xl
