# language: es
Característica: las rutas de los files[] de una colección

  Como quien organiza un libro en carpetas
  Quiero que los miembros se busquen desde la colección y desde la raíz
  Para no editar mi frontmatter al mover un archivo

  Regla de negocio: Relativo a la colección primero, raíz después

    Escenario: Un miembro con ../ se resuelve desde la raíz
      Dado que la raíz del proyecto está vacía
      Y una colección en subdirectorios con los dos estilos de rutas
      Cuando descubro y normalizo las rutas de las colecciones
      Entonces los files de "sub/coleccion.md" son "raiz.md, sub/miembro-local.md"
      Y el frontmatter de "sub/coleccion.md" también queda normalizado

    Escenario: Un miembro escrito desde la raíz se resuelve igual
      Dado que la raíz del proyecto está vacía
      Y una colección en subdirectorios con los dos estilos de rutas
      Cuando descubro y normalizo las rutas de las colecciones
      Entonces los files de "sub/c2.md" son "sub/miembro2.md"

    Escenario: Un archivo inexistente se deja como está y falla al leer
      Dado que la raíz del proyecto está vacía
      Y una colección que apunta a un archivo que no existe
      Cuando descubro y normalizo las rutas de las colecciones
      Entonces los files de "test/collection.md" son "../02-prologo.md"
      Cuando intento leer los miembros de "../02-prologo.md" de "test/collection.md"
      Y la lectura falla con un BuildError que lista:
        """
        collection "test/collection.md"
        "../02-prologo.md"
        """
        Y el mensaje dice las dos rutas absolutas que se probaron

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

    Escenario: Creado el archivo, validate pasa
      Dado que la raíz del proyecto está vacía
      Y una colección que apunta a un archivo que no existe
      Cuando valido el proyecto buscando archivos faltantes
      Entonces aparecen los archivos que faltaban
      Cuando valido el proyecto buscando archivos faltantes
      Y validate sale con código 0 tras comprobar los archivos

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