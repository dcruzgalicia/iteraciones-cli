# language: es
Característica: cuando el slug de un documento cambia

  Como quien renombra un documento Adding a su autor
  Quiero que el archivo viejo desaparezca de la salida
  Para que `dist` no se llene de versiones viejas de lo mismo

  Regla de negocio: Quitar el autor deja el slug anterior con su nombre

    Escenario: Al quitar el autor se recuerda el slug con el nombre
      Dado que la raíz del proyecto está vacía
      Y un documento que se titula "Prueba" con "Juan Pérez"
      Cuando hago el build
      Y el documento pasa a llamarse "Prueba" con ""
      Y el documento queda con fecha de modificación futura
      Cuando hago el build
      Entonces el slug anterior de "doc.md" fue "prueba-por-juan-perez"
      Y el slug del documento "doc.md" es "prueba"

  Regla de negocio: Añadir el autor deja el slug anterior sin su nombre

    Escenario: Al añadir el autor se recuerda el slug sin el nombre
      Dado que la raíz del proyecto está vacía
      Y un documento que se titula "Prueba" con ""
      Cuando hago el build
      Y el documento pasa a llamarse "Prueba" con "Juan Pérez"
      Y el documento queda con fecha de modificación futura
      Cuando hago el build
      Entonces el slug anterior de "doc.md" fue "prueba"
      Y el slug del documento "doc.md" es "prueba-por-juan-perez"

  Regla de negocio: Acortar el título también cuenta

    Escenario: Al acortar el título se recuerda el slug largo
      Dado que la raíz del proyecto está vacía
      Y un documento que se titula "Guía Completa" con ""
      Cuando hago el build
      Y el documento pasa a llamarse "Guía" con ""
      Y el documento queda con fecha de modificación futura
      Cuando hago el build
      Entonces el slug anterior de "doc.md" fue "guia-completa"
      Y el slug del documento "doc.md" es "guia"

  Regla de negocio: Cambiar de autor renombra el archivo

    Escenario: Al cambiar de autor se recuerda el slug del anterior
      Dado que la raíz del proyecto está vacía
      Y un documento que se titula "Prueba" con "Autor A"
      Cuando hago el build
      Y el documento pasa a llamarse "Prueba" con "Autor B"
      Y el documento queda con fecha de modificación futura
      Cuando hago el build
      Entonces el slug anterior de "doc.md" fue "prueba-por-autor-a"
      Y el slug del documento "doc.md" es "prueba-por-autor-b"

  Regla de negocio: Cada renombre limpia su propio anterior

    Escenario: Cambiar y luego quitar deja limpios los dos anteriores
      Dado que la raíz del proyecto está vacía
      Y un documento que se titula "Prueba" con "Autor A"
      Cuando hago el build
      Y el documento pasa a llamarse "Prueba" con "Autor B"
      Y el documento queda con fecha de modificación futura
      Cuando hago el build
      Entonces el slug anterior de "doc.md" fue "prueba-por-autor-a"
      Y el slug del documento "doc.md" es "prueba-por-autor-b"
      Y el documento pasa a llamarse "Prueba" con ""
      Y el documento queda con fecha de modificación futura
      Cuando hago el build
      Entonces el slug anterior de "doc.md" fue "prueba-por-autor-b"
      Y el slug del documento "doc.md" es "prueba"

  Regla de negocio: Editar el cuerpo no cambia el slug

    Escenario: Cambiar sólo el contenido no genera slug anterior
      Dado que la raíz del proyecto está vacía
      Y un documento que se titula "Prueba" con "Juan Pérez"
      Cuando hago el build
      Entonces el documento cambia sólo el contenido con autor
      Cuando hago el build
      Y "doc.md" sí cambió
      Y nadie cambió de slug
      Y el slug del documento "doc.md" es "prueba-por-juan-perez"

  Regla de negocio: El sufijo de duplicado sobrevive

    Escenario: Un duplicado que queda único conserva su -d1
      Dado que la raíz del proyecto está vacía
      Y un documento que se titula "Prueba" con ""
      Cuando hago el build
      Entonces aparece otro documento con el mismo título "Prueba"
      Y el documento queda con fecha de modificación futura
      Cuando hago el build
      Y el slug del documento "doc.md" es "prueba-d1"
      Y elimino el documento duplicado
      Y el documento queda con fecha de modificación futura
      Cuando hago el build
      Y el slug del documento "doc.md" es "prueba-d1"
      Y nadie cambió de slug
      Y "doc.md" NO cambió

    Escenario: Editar el cuerpo conserva el -dN
      Dado que la raíz del proyecto está vacía
      Y un documento que se titula "Prueba" con ""
      Cuando hago el build
      Entonces aparece otro documento con el mismo título "Prueba"
      Y el documento queda con fecha de modificación futura
      Cuando hago el build
      Y el documento cambia sólo el contenido sin autor
      Cuando hago el build
      Y el slug del documento "doc.md" es "prueba-d1"
      Y nadie cambió de slug

  Regla de negocio: El slug manual manda y también se recuerda (#2012)

    Escenario: Cambiar el slug manual deja el viejo para limpiar
      Dado que la raíz del proyecto está vacía
      Y el documento tiene el slug manual "vieja"
      Cuando hago el build
      Y el documento cambia su slug manual a "nueva"
      Y el documento queda con fecha de modificación futura
      Cuando hago el build
      Entonces el slug anterior de "doc.md" fue "vieja"
      Y el slug del documento "doc.md" es "nueva"

    Escenario: Sin estado previo el slug se resuelve limpio
      Dado que la raíz del proyecto está vacía
      Y un documento que se titula "Prueba" con ""
      Cuando hago el build
      Entonces hago el build completo sin estado previo
      Y el slug del documento "doc.md" es "prueba"
      Y nadie cambió de slug

  Regla de negocio: Un diacrítico que altera palabras se avisa (#2090)

    Escenario: La ñ avisa y propone el slug resultante
      Dado que la raíz del proyecto está vacía
      Y un documento que se titula "Año del jalapeño" con ""
      Cuando hago el build mirando stderr
      Y el slug del documento "doc.md" es "ano-del-jalapeno"
      Entonces stderr advierte que el slug altera palabras del título
      Y stderr propone el slug "ano-del-jalapeno"

    Escenario: Un acento que no cambia la palabra no avisa
      Dado que la raíz del proyecto está vacía
      Y un documento que se titula "Corazón profundo" con ""
      Cuando hago el build mirando stderr
      Y el slug del documento "doc.md" es "corazon-profundo"
      Entonces stderr no advierte por diacríticos
