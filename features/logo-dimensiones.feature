# language: es
Característica: dimensiones del logo y los iconos

  Para que el navegador reserve el espacio antes de cargar las imágenes
  Quiero que el logo y los iconos declaren ancho y alto

  Escenario: El logo declara sus dimensiones
    Cuando genero el bloque del logo con tamaño "50px"
    Entonces el logo declara ancho y alto de 100
