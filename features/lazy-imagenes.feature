# language: es
Característica: lazy loading de imágenes de tarjeta

  Para que las imágenes bajo el pliegue no bloqueen la primera pintura
  Quiero cargar en diferido las tarjetas siguientes

  Escenario: La primera imagen carga de inmediato y la segunda en diferido
    Cuando genero dos tarjetas de colección con imagen
    Entonces la primera imagen no es lazy
    Y la segunda imagen es lazy
