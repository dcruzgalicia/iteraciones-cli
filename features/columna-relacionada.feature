# language: es
Característica: colapsar la columna relacionada vacía

  Para que el texto use todo el ancho cuando no hay contenido relacionado
  Quiero que la columna vacía desaparezca del HTML

  Escenario: Una columna relacionada vacía se elimina
    Cuando postproceso un HTML con la columna relacionada vacía
    Entonces el HTML no contiene el slot relacionado

  Escenario: Una columna relacionada con contenido se conserva
    Cuando postproceso un HTML con la columna relacionada llena
    Entonces el HTML contiene el slot relacionado
