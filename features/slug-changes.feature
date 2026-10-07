# language: es
Característica: cuando el slug de un documento cambia

  Como quien renombra un documento Adding a su autor
  Quiero que el archivo viejo desaparezca de la salida
  Para que `dist` no se llene de versiones viejas de lo mismo

  # Tramo 38 de la migración. 11 de los 13 casos de `slug-changes.test.ts`.

  # El slug es el nombre del archivo en `dist`. Cuando cambia, el archivo viejo
  # se queda ahí para siempre: `dist/prueba-por-juan-perez.pdf` conviviendo con
  # `dist/prueba.pdf`. Esta lista es la que alimenta la limpieza de los dos —la
  # salida y la caché— y sin ella el `dist` engorda en cada renombre.

  # Y la comparación es de SLUG, no de metadatos. Dos casos lo hacen importante:
  # quitar el creator deja `prueba-por-juan-perez` y `prueba`, donde el nuevo es
  # PREFIJO del viejo; y lo mismo al acortar el título. Una comparación mal
  # escrita dejaría el archivo viejo sin borrar justo en los casos que más
  # duelen.

  Regla de negocio: Quitar el autor deja el slug anterior con su nombre

    Escenario: Al quitar el autor se recuerda el slug con el nombre
      Dado que la raíz del proyecto está vacía
      Y un documento que se titula "Prueba" con "Juan Pérez"
      Cuando hago el build
      Y el documento pasa a llamarse "Prueba" con ""
      Y el documento queda con fecha de modificación futura
      Cuando hago el build
      # El slug nuevo es el slug viejo sin el sufijo: `prueba`.
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
      # El caso inverso: el nuevo slug es el viejo MÁS largo.
      Entonces el slug anterior de "doc.md" fue "prueba"
      Y el slug del documento "doc.md" es "prueba-por-juan-perez"

  Regla de negocio: Acortar el título también cuenta

    # `guia-completa` → `guia`. Un prefijo, otra vez: el caso que rompe las
    # comparaciones ingenuas.

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
      # Mismo título, otro autor: sólo cambia el sufijo.
      Entonces el slug anterior de "doc.md" fue "prueba-por-autor-a"
      Y el slug del documento "doc.md" es "prueba-por-autor-b"

  # --- Tramo 38 ---

  # Cada paso se limpia a su vez: cambiar de autor borra el slug del autor
  # anterior, y quitarlo después borra el del autor actual. Sin esto, tras dos
  # renombres quedaría un archivo muerto en `dist`.

  Regla de negocio: Cada renombre limpia su propio anterior

    Escenario: Cambiar y luego quitar deja limpios los dos anteriores
      Dado que la raíz del proyecto está vacía
      Y un documento que se titula "Prueba" con "Autor A"
      Cuando hago el build
      Y el documento pasa a llamarse "Prueba" con "Autor B"
      Y el documento queda con fecha de modificación futura
      Cuando hago el build
      # Primer paso: se limpia el slug del Autor A.
      Entonces el slug anterior de "doc.md" fue "prueba-por-autor-a"
      Y el slug del documento "doc.md" es "prueba-por-autor-b"
      Y el documento pasa a llamarse "Prueba" con ""
      Y el documento queda con fecha de modificación futura
      Cuando hago el build
      # Segundo paso: se limpia el slug del Autor B, no el del A otra vez.
      Entonces el slug anterior de "doc.md" fue "prueba-por-autor-b"
      Y el slug del documento "doc.md" es "prueba"

  Regla de negocio: Editar el cuerpo no cambia el slug

    # El archivo cambió y su `dist` se regenera, pero el slug es el mismo: no hay
    # nada que limpiar. Registrar un cambio aquí borraría un archivo que sigue
    # vivo.

    Escenario: Cambiar sólo el contenido no genera slug anterior
      Dado que la raíz del proyecto está vacía
      Y un documento que se titula "Prueba" con "Juan Pérez"
      Cuando hago el build
      Entonces el documento cambia sólo el contenido con autor
      Cuando hago el build
      # El archivo SÍ cambió: lo que no cambia es su nombre.
      Y "doc.md" sí cambió
      Y nadie cambió de slug
      Y el slug del documento "doc.md" es "prueba-por-juan-perez"
  # --- Tramo 38: el sufijo de duplicado, el slug manual y los diacríticos ---

  # El sufijo `-dN` es lo que evita que dos documentos con el mismo título se
  # pisen. Sobrevive a que el duplicado desaparezca: quitarlo no es un renombre.

  Regla de negocio: El sufijo de duplicado sobrevive

    Escenario: Un duplicado que queda único conserva su -d1
      Dado que la raíz del proyecto está vacía
      Y un documento que se titula "Prueba" con ""
      Cuando hago el build
      Entonces aparece otro documento con el mismo título "Prueba"
      Y el documento queda con fecha de modificación futura
      Cuando hago el build
      # El segundo entra al grupo de duplicados y el primero conserva su sitio.
      Y el slug del documento "doc.md" es "prueba-d1"
      Y elimino el documento duplicado
      Y el documento queda con fecha de modificación futura
      Cuando hago el build
      # `prueba-d1` sigue siendo su nombre: quitar el otro no es renombrarlo.
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
      # El contenido cambió y el slug sigue con sufijo: nada que limpiar.
      Y el slug del documento "doc.md" es "prueba-d1"
      Y nadie cambió de slug

  Regla de negocio: El slug manual manda y también se recuerda (#2012)

    # Un `slug:` explícito es la decisión del autor sobre el nombre del
    # archivo. Cambiarlo es un renombre como cualquier otro: el archivo viejo
    # se limpia.

    Escenario: Cambiar el slug manual deja el viejo para limpiar
      Dado que la raíz del proyecto está vacía
      Y el documento tiene el slug manual "vieja"
      Cuando hago el build
      Y el documento cambia su slug manual a "nueva"
      Y el documento queda con fecha de modificación futura
      Cuando hago el build
      # El título sigue siendo el mismo; lo que cambió fue el nombre pedido.
      Entonces el slug anterior de "doc.md" fue "vieja"
      Y el slug del documento "doc.md" es "nueva"

    Escenario: Sin estado previo el slug se resuelve limpio
      Dado que la raíz del proyecto está vacía
      Y un documento que se titula "Prueba" con ""
      Cuando hago el build
      Entonces hago el build completo sin estado previo
      # Sin estado no hay con qué comparar, así que no hay nada que limpiar.
      Y el slug del documento "doc.md" es "prueba"
      Y nadie cambió de slug

  Regla de negocio: Un diacrítico que altera palabras se avisa (#2090)

    # La `ñ` se convierte en `n` porque un archivo no la lleva. Eso cambia
    # "Año" por "Ano", que es otra palabra: el autor tiene que saberlo.

    Escenario: La ñ avisa y propone el slug resultante
      Dado que la raíz del proyecto está vacía
      Y un documento que se titula "Año del jalapeño" con ""
      Cuando hago el build mirando stderr
      # El aviso trae el slug exacto, no un "revisa tu título".
      Y el slug del documento "doc.md" es "ano-del-jalapeno"
      Entonces stderr advierte que el slug altera palabras del título
      Y stderr propone el slug "ano-del-jalapeno"

    Escenario: Un acento que no cambia la palabra no avisa
      Dado que la raíz del proyecto está vacía
      Y un documento que se titula "Corazón profundo" con ""
      Cuando hago el build mirando stderr
      # "Corazon" sigue siendo "corazón": el aviso sería ruido.
      Y el slug del documento "doc.md" es "corazon-profundo"
      Entonces stderr no advierte por diacríticos
