# language: es
Característica: cuántos autores caben en el nombre del archivo

  Como quien escribe en coautoría
  Quiero saber cuántos autores entran en el nombre de la salida
  Para no dejar a un coautor fuera sin darme cuenta

  Regla de negocio: Por defecto cabe un autor en el nombre

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
