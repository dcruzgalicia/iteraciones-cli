# language: es
Característica: orden móvil de las tarjetas

  Para que al apilarse todo en una columna el orden siga siendo claro
  Quiero título, contenido, autora, formatos/índice, relacionados y licencia

  Escenario: El orden móvil de una página file
    Cuando compongo la plantilla HTML para revisar el orden móvil
    Entonces el título va antes que el contenido
    Y el contenido va antes que la autora
    Y la autora va antes que los formatos
    Y los formatos van antes que la licencia
