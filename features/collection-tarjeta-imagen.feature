# language: es
Característica: la imagen de cabecera de las tarjetas

  Como quien recorre una lista de textos
  Quiero ver la primera imagen del texto en su tarjeta
  Para reconocerlo sin abrir el archivo

  Regla de negocio: Un texto que empieza con imagen conserva su preview

    Escenario: La tarjeta salta la imagen y usa el primer párrafo
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el proyecto produce html
      Y un texto en "autoras/historikas" que empieza con la imagen "Mapa.png"
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/texto.html" dice "Primer párrafo del texto."
      Y el archivo "dist/files/texto.html" dice "assets/images/lista-Mapa"
      Y el archivo "dist/files/texto.html" no dice "imagenes/Mapa.png"

    Escenario: La imagen va después de los chips y antes del título
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el proyecto produce html
      Y un texto en "autoras/historikas" que empieza con la imagen "Mapa.png"
      Cuando hago un build del proyecto
      Entonces el archivo "dist/files/texto.html" pone "assets/images/lista-Mapa" antes que "Tres libros"
      Y el archivo "dist/files/texto.html" dice "h-[100px]"
      Y el archivo "dist/files/texto.html" dice "rounded-tr-xl rounded-bl-xl"
      Y el archivo "dist/files/texto.html" dice "object-cover"

    Escenario: En una colección en subdirectorio la ruta se resuelve desde la página
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el proyecto produce html
      Y un texto en "autoras/historikas" que empieza con la imagen "Mapa.png"
      Y una colección en "convocatorias" que incluye "autoras/historikas/tres-libros.md"
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/convocatorias/antologia.html" dice "assets/images/antologia-Mapa"
      Y el archivo "dist/files/convocatorias/antologia.html" no dice "imagenes/Mapa.png"

    Escenario: Un texto sin imágenes no lleva figura
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el proyecto produce html
      Y un texto de "Ana García"
      Cuando hago un build del proyecto
      Entonces el archivo "dist/files/texto.html" no dice "<figure"
