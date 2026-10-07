# language: es
Característica: las rutas de los files[] de una colección

  Como quien organiza un libro en carpetas
  Quiero que los miembros se busquen desde la colección y desde la raíz
  Para no editar mi frontmatter al mover un archivo

  # Tramo 51 de la migración. 4 de los 6 casos de
  # `collection-files-paths.test.ts`. Quedan 2: los builds reales con pandoc.

  # Un `files: [../prólogo.md]` en `sub/coleccion.md` significa `prólogo.md` en la
  # raíz: la ruta es relativa a la colección. Pero un `files: [sub/miembro.md]`
  # escrito en una colección dentro de `sub/` significaría `sub/sub/miembro.md`,
  # que no existe.

  Regla de negocio: Relativo a la colección primero, raíz después

    # Se prueban las dos y gana la que está. Es el fallback que hace que los
    # proyectos con la convención antigua sigan funcionando sin editar nada.

    Escenario: Un miembro con ../ se resuelve desde la raíz
      Dado que la raíz del proyecto está vacía
      Y una colección en subdirectorios con los dos estilos de rutas
      Cuando descubro y normalizo las rutas de las colecciones
      Entonces los files de "sub/coleccion.md" son "raiz.md, sub/miembro-local.md"
      Y el frontmatter de "sub/coleccion.md" también queda normalizado

    # Un `files:` escrito como `sub/miembro2.md` desde `sub/` resolvería a
    # `sub/sub/miembro2.md`: el fallback a la raíz es lo que lo salva.
    Escenario: Un miembro escrito desde la raíz se resuelve igual
      Dado que la raíz del proyecto está vacía
      Y una colección en subdirectorios con los dos estilos de rutas
      Cuando descubro y normalizo las rutas de las colecciones
      Entonces los files de "sub/c2.md" son "sub/miembro2.md"

    # Normalizar no puede lanzar: el índice se construye para toda la colección, y
    # que un miembro falte no invalida a los demás.
    Escenario: Un archivo inexistente se deja como está y falla al leer
      Dado que la raíz del proyecto está vacía
      Y una colección que apunta a un archivo que no existe
      Cuando descubro y normalizo las rutas de las colecciones
      Entonces los files de "test/collection.md" son "../02-prologo.md"
      Cuando intento leer los miembros de "../02-prologo.md" de "test/collection.md"
      # Quien lanza es la lectura, que es donde de verdad se necesita el archivo.
      Y la lectura falla con un BuildError que lista:
        """
        collection "test/collection.md"
        "../02-prologo.md"
        """
        Y el mensaje dice las dos rutas absolutas que se probaron


  # Sin las rutas que se probaron el autor ve `no encontrado "../prólogo.md"` y no
  # sabe si debería escribirlo relativo a la colección o a la raíz. Con las dos
  # en el mensaje, la respuesta está en el error.

  Regla de negocio: El error dice dónde se buscó

    Escenario: Validate lista las rutas que intentó
      Dado que la raíz del proyecto está vacía
      Y una colección que apunta a un archivo que no existe
      Cuando valido el proyecto buscando archivos faltantes
      Entonces validate sale con código 1 tras comprobar los archivos
      Y validate dice:
        """
        files: no encontrado "../02-prologo.md"
        """

    # Creado el archivo, validate pasa: el aviso era sobre el archivo y no sobre
    # la resolución.
    Escenario: Creado el archivo, validate pasa
      Dado que la raíz del proyecto está vacía
      Y una colección que apunta a un archivo que no existe
      Cuando valido el proyecto buscando archivos faltantes
      Entonces aparecen los archivos que faltaban
      Cuando valido el proyecto buscando archivos faltantes
      Y validate sale con código 0 tras comprobar los archivos

    # `merge` tiene que resolver igual que el build: si lee distinto, el markdown
    # fusionado sale con otro contenido que el que da el build.
    Escenario: Merge resuelve igual que el build
      Dado que la raíz del proyecto está vacía
      Y una colección en un subdirectorio que apunta a la raíz
      Cuando fusiono "sub/c.md" en markdown
      Entonces merge sale con código 0
      Y el markdown fusionado contiene:
        """
        ## Autora X
        Contenido fusionable.
        """