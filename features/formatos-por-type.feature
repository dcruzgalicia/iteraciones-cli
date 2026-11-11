# language: es
Característica: formatos por type

  Para no generar PDF, EPUB y LaTeX de documentos que sólo existen en HTML
  Quiero una matriz explícita de qué formato produce cada type

  Esquema del escenario: La matriz de formatos
    Cuando pregunto si el type "<type>" produce "<formato>"
    Entonces la respuesta es "<respuesta>"

    Ejemplos:
      | type         | formato  | respuesta |
      | file         | pdf      | sí        |
      | file         | epub     | sí        |
      | collection   | pdf      | sí        |
      | collection   | html     | sí        |
      | creator      | pdf      | no        |
      | creator      | html     | sí        |
      | list         | epub     | no        |
      | menu         | pdf      | no        |
      | announcement | markdown | no        |
      | intervention | pdf      | sí        |
      | intervention | html     | no        |
      | intervention | markdown | sí        |
      | desconocido  | pdf      | sí        |
