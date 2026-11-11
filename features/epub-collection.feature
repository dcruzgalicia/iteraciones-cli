# language: es
Característica: EPUB de una colección

  Para que un libro se pueda navegar por capítulos y llevar sus metadatos
  Quiero un XHTML por capítulo, portada, índice y metadatos

  Escenario: El EPUB de una colección se navega por capítulos
    Dado un proyecto con una colección y un EPUB con portada y metadatos
    Cuando hago un build del proyecto
    Entonces el comando termina con el código de salida 0
    Y el EPUB "libro" tiene al menos 2 capítulos XHTML
