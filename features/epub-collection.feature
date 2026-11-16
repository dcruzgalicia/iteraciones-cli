Característica: EPUB de una colección

  Para que un libro se pueda navegar por capítulos y llevar sus metadatos
  Quiero un XHTML por capítulo, portada, índice y metadatos

  Escenario: El EPUB de una colección se navega por capítulos
    Dado un proyecto con una colección y un EPUB con portada y metadatos
    Cuando hago un build del proyecto
    Entonces el comando termina con el código de salida 0
    Y el EPUB "libro" tiene al menos 2 capítulos XHTML
    Y el EPUB "libro" tiene en el índice "Capítulo uno"
    Y el EPUB "dist/files/libro.epub" lleva la portada como cover
    Y el EPUB "libro" declara la clave "dc:description" con el valor "Descripción del libro"
    Y el EPUB "libro" declara la clave "dc:rights" con el valor "Derechos reservados"
    Y el EPUB "libro" declara la clave "dc:subject" con el valor "pruebas"
    Y el EPUB "libro" incluye una imagen


  Escenario: El EPUB usa fuentes del dispositivo y pesa menos de 25 KB por imagen
    Dado un proyecto con una colección y un EPUB con portada y metadatos
    Cuando hago un build del proyecto
    Entonces el comando termina con el código de salida 0
    Y el EPUB "libro" no incluye fuentes incrustadas
    Y el EPUB "libro" no tiene @font-face
    Y las imágenes del EPUB "libro" pesan menos de 25 KB
