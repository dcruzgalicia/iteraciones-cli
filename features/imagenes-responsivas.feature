Característica: imágenes responsivas en HTML

  Como quien publica un sitio con imágenes
  Quiero que el navegador descargue la variante adecuada
  Para no cargar imágenes de 1024 px en tarjetas y contenido pequeño

  Escenario: Las imágenes de contenido usan srcset, dimensiones y lazy loading
    Dado que la raíz del proyecto tiene un proyecto de prueba
    Y el proyecto produce html
    Y un texto con una imagen grande
    Cuando hago un build del proyecto
    Entonces el comando termina con el código de salida 0
    Y el HTML de "texto.html" tiene imágenes responsivas
    Y el archivo "dist/files/assets/images/texto-grande-200.webp" existe
