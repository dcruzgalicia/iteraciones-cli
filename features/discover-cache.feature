# language: es
Característica: la caché del descubrimiento

  Como quien edita un párrafo y recompila
  Quiero que el build sepa si el archivo cambió de verdad
  Para no esperar diez minutos, ni salir con un PDF viejo

  # Tramo 45 de la migración. 10 de los 10 casos de `discover-cache.test.ts`.
  # El archivo queda cerrado.

  # Un archivo puede haber cambiado sin que el build lo note, y ese es el fallo
  # caro: el autor edita, compila y sale un PDF viejo SIN NINGÚN ERROR.

  # Por eso la caché escalona —cada pregunta sale más cara que la anterior—:
  #
  # 1. ¿mismo mtime y mismo tamaño? → no se lee el archivo. Es el caso normal de
  #    un rebuild, así que tiene que ser sólo un `stat`.
  # 2. ¿tamaño distinto? → cambió, sin necesidad de hashear.
  # 3. mtime distinto con tamaño igual → hay que leer y hashear. Y el hash
  #    decide: si es igual, era un `touch` o un `git clone`, y el archivo NO se
  #    reprocesa.

  Regla de negocio: Un rebuild sin cambios no lee nada

    Escenario: El primer build marca todo como cambiado
      Dado que la raíz del proyecto está vacía
      Y un proyecto con un documento
      Cuando descubro el proyecto
      # Sin estado previo no hay con qué comparar: todo entra.
      Entonces los documentos que cambiaron son "doc.md"

    Escenario: El segundo build no cambia nada
      Dado que la raíz del proyecto está vacía
      Y un proyecto con un documento
      Cuando descubro el proyecto
      Cuando descubro el proyecto
      # Sólo un `stat` por archivo: es el caso que se repite en cada rebuild.
      Entonces nada cambió

    Escenario: Sin título en el frontmatter se avisa
      Dado que la raíz del proyecto está vacía
      Y un proyecto con un documento
      Y aparece un documento sin título en el frontmatter
      Cuando descubro el proyecto mirando stderr
      # El aviso trae el archivo, el problema y el título que se puso.
      Entonces stderr dice:
        """
        sin-titulo.md
        no tiene título
        Sin título
        """

  # --- Tramo 45: el `touch` y el `git clone` ---

  # La `ñ` del `touch`: el contenido no cambia pero el mtime sí. Un build que se
  # fiara del mtime recompilaría un archivo que nadie editó.

  Regla de negocio: El `touch` no dispara un rebuild

    Escenario: Tocar un archivo no lo cambia
      Dado que la raíz del proyecto está vacía
      Y un proyecto con un documento
      Cuando descubro el proyecto
      Entonces el documento se toca 60 segundos en el futuro
      Cuando descubro el proyecto
      # El hash es igual, así que el archivo no se reprocesa.
      Y nada cambió
      Cuando descubro el proyecto
      Y nada cambió

    # Si tras el `touch` no se guardara el mtime nuevo, este build volvería a
    # hashear el mismo archivo — y el siguiente también. El `touch` se paga una
    # vez, no en cada build.
    Escenario: El mtime del toque queda persistido (#2188)
      Dado que la raíz del proyecto está vacía
      Y un proyecto con un documento
      Cuando descubro el proyecto
      Entonces anoto el estado persistido
      Y el documento se toca 60 segundos en el futuro
      Cuando descubro el proyecto
      # El mtime guardado es el del toque y el hash sigue siendo el mismo.
      Y el mtime persistido es el del toque
      Y el hash persistido NO cambió
      Cuando descubro el proyecto
      # Con el mtime persistido, el tercer build acierta con el `stat`.
      Y nada cambió

    # Un `git clone` reescribe los mtimes de TODO con el mismo contenido. Si el
    # build se fiara del mtime, el primer build tras cada clone reprocesaría el
    # proyecto entero. El hash es lo que salva ese caso.
    Escenario: Un clon reescrito con el mismo contenido no cambia nada
      Dado que la raíz del proyecto está vacía
      Y un proyecto con un documento
      Cuando descubro el proyecto
      Entonces el documento se reescribe con el mismo contenido 240 segundos después
      Cuando descubro el proyecto
      # Mismo tamaño, mismo hash: el rebuild entero sale en un segundo.
      Y nada cambió

  Regla de negocio: Los cambios de verdad sí se ven

    # Mismo tamaño y contenido distinto: sólo el hash lo distingue de un
    # `touch`. Si aquí no se detectara, el cambio se perdería en silencio.
    Escenario: Un cambio del mismo tamaño se detecta por el hash
      Dado que la raíz del proyecto está vacía
      Y un proyecto con un documento
      Cuando descubro el proyecto
      Entonces el documento cambia por uno del mismo tamaño
      Y el documento se toca 120 segundos en el futuro
      Cuando descubro el proyecto
      Y los documentos que cambiaron son "doc.md"

    # Tamaño distinto: no hace falta ni leer el archivo.
    Escenario: Un cambio de tamaño se detecta sin hashear
      Dado que la raíz del proyecto está vacía
      Y un proyecto con un documento
      Cuando descubro el proyecto
      Entonces el documento crece
      Cuando descubro el proyecto
      Y los documentos que cambiaron son "doc.md"

    Escenario: Un documento nuevo entra como cambiado
      Dado que la raíz del proyecto está vacía
      Y un proyecto con un documento
      Cuando descubro el proyecto
      Entonces aparece un documento nuevo
      Cuando descubro el proyecto
      Y los documentos que cambiaron son "nuevo.md"

    # Un borrado necesita más que `changedPaths`: la limpieza lo usa para saber
    # que tiene que borrar las salidas de ese slug (#2452).
    Escenario: Un documento borrado se marca y entra en los borrados
      Dado que la raíz del proyecto está vacía
      Y un proyecto con un documento
      Cuando descubro el proyecto
      Entonces se borra el documento
      Cuando descubro el proyecto
      Y los documentos que cambiaron son "doc.md"
      Y "doc.md" está en los borrados