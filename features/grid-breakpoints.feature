Característica: columnas del grid por breakpoint

  Para que las tarjetas y el contenido no se aprieten en ningún ancho
  Quiero columnas explícitas en cada breakpoint

  Escenario: El grid de contenido deja el ancho del sidebar
    Cuando leo las utilidades de grid
    Entonces content-grid usa una columna base
    Y content-grid reserva el ancho del sidebar desde sm

  Escenario: Los previews cambian de 1 a 3 columnas
    Cuando leo las utilidades de grid
    Entonces preview-grid usa 1 columna base
    Y preview-grid usa 2 columnas en 800
    Y preview-grid usa 1 columna en md
    Y preview-grid usa 2 columnas en 1120
    Y preview-grid usa 3 columnas en xl

  Escenario: En sm el contenido ocupa una columna y el aside dos
    Cuando leo las utilidades de grid
    Entonces las páginas con sidebar usan una columna en sm
    Y el aside usa dos columnas internas en sm

  Regla de negocio: La portada de la cabecera reparte el ancho

    Escenario: En móvil la portada se limita y se centra
      Cuando leo las utilidades de grid
      Entonces la portada de la cabecera mide hasta 320px y está centrada

    Escenario: En sm la cabecera tiene dos columnas y la portada se limita a 320px
      Cuando leo las utilidades de grid
      Entonces la cabecera con portada tiene 2 columnas en sm
      Y la portada de la cabecera se limita a 320px en sm

    Escenario: En md el contenido ocupa dos de tres columnas
      Cuando leo las utilidades de grid
      Entonces la cabecera con portada tiene 3 columnas en md
      Y el contenido de la cabecera ocupa 2 columnas en md

    Escenario: En xl el contenido ocupa tres de cuatro columnas
      Cuando leo las utilidades de grid
      Entonces la cabecera con portada tiene 4 columnas en xl
      Y el contenido de la cabecera ocupa 3 columnas en xl

  Regla de negocio: La portada y la contraportada forman una pareja centrada

    Escenario: La pareja siempre usa dos columnas de hasta 320px
      Cuando leo las utilidades de grid
      Entonces la pareja de portadas usa dos columnas de 320px
      Y la contraportada va antes que la portada

    Escenario: En lg la pareja usa su ancho y el contenido el resto
      Cuando leo las utilidades de grid
      Entonces la cabecera con dos portadas deja el resto al contenido en lg
      Y el contenido de la cabecera con dos portadas ocupa la segunda columna en lg

    Escenario: En xl la pareja usa su ancho y el contenido el resto
      Cuando leo las utilidades de grid
      Entonces la cabecera con dos portadas deja el resto al contenido en xl
      Y el contenido de la cabecera con dos portadas ocupa la segunda columna en xl
