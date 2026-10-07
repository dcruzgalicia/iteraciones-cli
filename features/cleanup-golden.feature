# language: es
Característica: lo que queda en la salida

  Como quien publica y luego cambia de opinión
  Quiero que la salida contenga exactamente lo que pedí
  Para que no se acumulen archivos que nadie pidió

  # Tramo 54 de 54 (#2580). 4 de los 4 casos de `cleanup-golden.test.ts`.
  # Cierra la migración de los 54 tramos.

  # `index.md` se titula "Portada", pero su salida es `index.html`, no
  # `portada.html`. La limpieza usaba el slug del título en vez del slug de
  # salida, así que desactivar un formato dejaba los `index.*` huérfanos:
  # archivos que nadie pidió, que no enlaza nada y que nadie borra.

  Regla de negocio: Desactivar un formato elimina sus salidas

    Escenario: Al dejar sólo HTML desaparecen los demás formatos
      Dado que la raíz del proyecto está vacía
      Y un proyecto inicializado con todos los formatos
      Cuando construyo para ver el árbol de la salida
      Entonces la salida contiene:
        """
        index.tex
        index.epub
        index.md
        """
      Y el proyecto se queda sólo con HTML
      Cuando construyo para ver el árbol de la salida
      # Los `index.*` se van con el formato que ya no se pide.
      Y la salida ya NO contiene:
        """
        index.tex
        index.pdf
        index.epub
        index.md
        """
      Y la salida sólo contiene lo permitido:
        """
        index
        test-document
        """

  Regla de negocio: Cambiar el slug manual limpia el anterior

    Escenario: El slug viejo desaparece al renombrar
      Dado que la raíz del proyecto está vacía
      Y un proyecto inicializado con un slug manual
      Cuando construyo para ver el árbol de la salida
      Entonces la salida contiene:
        """
        mi-url-vieja.html
        """
      Y cambio el slug manual a "mi-url-nueva"
      Cuando construyo para ver el árbol de la salida
      Y la salida contiene:
        """
        mi-url-nueva.html
        """
      Y la salida ya NO contiene:
        """
        mi-url-vieja.html
        """

  Regla de negocio: Borrar un documento no deja directorios vacíos

    # `readdir` recursivo no ve un directorio vacío, así que el escenario mira si
    # queda alguna ruta bajo `posts/` en vez de mirar si el directorio existe.

    Escenario: El directorio del documento borrado desaparece
      Dado que la raíz del proyecto está vacía
      Y un proyecto inicializado con un documento en el directorio posts
      Cuando construyo para ver el árbol de la salida
      Entonces la salida contiene:
        """
        posts/borrable.html
        """
      Y borro el documento de posts
      Cuando construyo para ver el árbol de la salida
      Y la salida ya NO contiene:
        """
        posts/borrable.html
        """
      Y la salida no deja rutas bajo el prefijo "posts"

  # El bug de #2361: un build fresco con una collection no debe crashear en la
  # limpieza. Antes de eso, un crash de este tipo abortaba el build entero por un
  # archivo que ya estaba bien.

  Regla de negocio: Una colección nueva no rompe la limpieza

    Escenario: Un build con collection no crashea
      Dado que la raíz del proyecto está vacía
      Y un proyecto inicializado con una colección
      Cuando construyo para ver el árbol de la salida
      Entonces la salida contiene:
        """
        contenido/mi-collection.html
        """

  # ## El criterio de esta migración
  #
  # Los cuatro archivos que quedan en `bun:test` — `docs-config-integrity` (8),
  # `frontmatter-matrix` (7), `builder-isolation` (6) y `export-runner` (5) — **no
  # migran, y no por descuido**. Atan documentación y código entre sí leyendo los
  # archivos como texto y escaneando imports: el sujeto es el árbol de
  # dependencias y el contenido de un documento, no un comportamiento en runtime.
  # No hay `Cuando` porque no hay acción que ejecutar.
  #
  # Encarnarlos en Gherkin obligaría a inventar una acción para poder afirmar algo
  # que no ocurre, y el escenario resultante leería como si probara algo que no
  # prueba. Cada uno dice por qué en su cabecera.
