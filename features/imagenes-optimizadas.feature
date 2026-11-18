Característica: imágenes optimizadas en HTML

  Como quien publica un sitio con imágenes
  Quiero una sola imagen ligera por cada imagen fuente
  Para que el build no repita el mismo trabajo y el sitio pese menos

  Escenario: La imagen se publica una sola vez, con dimensiones y menos de 25 KB
    Dado que la raíz del proyecto tiene un proyecto de prueba
    Y el proyecto produce html
    Y un texto con una imagen grande
    Cuando hago un build del proyecto
    Entonces el comando termina con el código de salida 0
    Y el HTML de "texto.html" tiene una imagen optimizada
    Y la imagen de "texto.html" pesa menos de 25 KB
    Y el HTML de "texto.html" no tiene srcset
    Y hay una sola imagen procesada para "grande"

  Escenario: La misma imagen en dos documentos se procesa una sola vez
    Dado que la raíz del proyecto tiene un proyecto de prueba
    Y el proyecto produce html
    Y un texto con una imagen grande
    Y otro texto con la misma imagen grande
    Cuando hago un build del proyecto
    Entonces el comando termina con el código de salida 0
    Y los HTML de "texto.html" y "otro.html" referencian la misma imagen
    Y hay una sola imagen procesada para "grande"

  Escenario: La portada no se limita a 25 KB como las imágenes normales
    Dado que la raíz del proyecto tiene un proyecto de prueba
    Y el proyecto produce html
    Y un texto con una imagen grande
    Y una portada con textura
    Cuando hago un build del proyecto
    Entonces el comando termina con el código de salida 0
    Y la imagen de "texto.html" pesa menos de 25 KB
    Y la portada de "texto.html" pesa más de 25 KB
