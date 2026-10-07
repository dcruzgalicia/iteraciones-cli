# language: es
Característica: lo que queda en la salida

  Como quien publica y luego cambia de opinión
  Quiero que la salida contenga exactamente lo que pedí
  Para que no se acumulen archivos que nadie pidió

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

  Regla de negocio: Una colección nueva no rompe la limpieza

    Escenario: Un build con collection no crashea
      Dado que la raíz del proyecto está vacía
      Y un proyecto inicializado con una colección
      Cuando construyo para ver el árbol de la salida
      Entonces la salida contiene:
        """
        contenido/mi-collection.html
        """
