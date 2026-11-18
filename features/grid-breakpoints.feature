Característica: columnas del grid por breakpoint

  Para que las tarjetas y el contenido no se aprieten en ningún ancho
  Quiero columnas explícitas en cada breakpoint

  Escenario: El grid de contenido cambia de 1 a 4 columnas
    Cuando leo las utilidades de grid
    Entonces content-grid usa 1 columna base
    Y content-grid usa 2 columnas en sm
    Y content-grid usa 2 columnas en md
    Y content-grid usa 3 columnas en lg
    Y content-grid usa 4 columnas en xl

  Escenario: Los previews cambian de 1 a 3 columnas
    Cuando leo las utilidades de grid
    Entonces preview-grid usa 1 columna base
    Y preview-grid usa 2 columnas en sm
    Y preview-grid usa 1 columna en md
    Y preview-grid usa 2 columnas en lg
    Y preview-grid usa 3 columnas en xl

  Escenario: Las publicaciones de creadora llegan a tres columnas
    Cuando leo las utilidades de grid
    Entonces creator-publications-grid usa 1 columna base
    Y creator-publications-grid usa 2 columnas en lg
    Y creator-publications-grid usa 3 columnas en xl

  Regla de negocio: La portada de la cabecera reparte el ancho

    Escenario: En móvil la portada se limita y se centra
      Cuando leo las utilidades de grid
      Entonces la portada de la cabecera mide hasta 320px y está centrada

    Escenario: En sm la cabecera tiene dos columnas y la portada ocupa su columna
      Cuando leo las utilidades de grid
      Entonces la cabecera con portada tiene 2 columnas en sm
      Y la portada de la cabecera ocupa el 100% en sm

    Escenario: En md el contenido ocupa dos de tres columnas
      Cuando leo las utilidades de grid
      Entonces la cabecera con portada tiene 3 columnas en md
      Y el contenido de la cabecera ocupa 2 columnas en md

    Escenario: En xl el contenido ocupa tres de cuatro columnas
      Cuando leo las utilidades de grid
      Entonces la cabecera con portada tiene 4 columnas en xl
      Y el contenido de la cabecera ocupa 3 columnas en xl
