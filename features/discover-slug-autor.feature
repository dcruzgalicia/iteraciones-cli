# language: es
Característica: cuántos autores caben en el nombre del archivo

  Como quien escribe en coautoría
  Quiero saber cuántos autores entran en el nombre de la salida
  Para no dejar a un coautor fuera sin darme cuenta

  # Tramo 7 de la migración. 2 de los 38 casos de `discover.test.ts`.

  # Este feature tiene UNA sola tabla a propósito. `check-steps` mezcla las
  # filas de todas las tablas `Ejemplos` de un mismo feature, así que un
  # placeholder como `<max>` deja de casar si comparte archivo con otra tabla
  # que no tiene esa columna — y el checker reporta un paso sin definir que
  # cucumber resuelve bien. Una tabla por feature y el gate dice la verdad.

  Regla de negocio: Por defecto cabe un autor en el nombre

    # Con tres autores el nombre deja de ser legible y la URL deja de ser
    # estable, así que el recorte es el default y no una boast: quien quiera
    # más lo sube a mano, y el build deja constancia de haberlo hecho.

    Esquema del escenario: El autor sube cuántos autores caben en el nombre
      Dado que el documento se titula "<titulo>"
      Y que el documento tiene de autor "<autor>"
      Y que el nombre admite hasta <max> autores
      Cuando calculo el nombre del archivo de salida
      Entonces el nombre de salida es "<nombre>"

      Ejemplos:
        | titulo | autor | max | nombre |
        | Test | A, B, C | 3 | test-por-a-y-b-y-c |
        | Doc | Ana, Luis | 2 | doc-por-ana-y-luis |
