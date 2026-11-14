Característica: dimensiones del logo y los iconos

  Para que el navegador reserve el espacio antes de cargar las imágenes
  Quiero que el logo y los iconos declaren ancho y alto

  Escenario: El logo declara sus dimensiones
    Cuando genero el bloque del logo con tamaño "50px"
    Entonces el logo declara ancho y alto de 100

  Escenario: Los iconos se sirven al doble de su tamaño visible
    Dado que la raíz del proyecto está vacía
    Y una salida para los assets
    Cuando construyo los assets
    Entonces el icono "menu.webp" mide al menos 48 px
    Y el icono "arrow-upward.webp" mide al menos 72 px
