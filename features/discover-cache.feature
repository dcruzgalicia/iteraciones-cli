# language: es
Característica: la caché del descubrimiento

  Como quien edita un párrafo y recompila
  Quiero que el build sepa si el archivo cambió de verdad
  Para no esperar diez minutos, ni salir con un PDF viejo

  Regla de negocio: Un rebuild sin cambios no lee nada

    Escenario: El primer build marca todo como cambiado
      Dado que la raíz del proyecto está vacía
      Y un proyecto con un documento
      Cuando descubro el proyecto
      Entonces los documentos que cambiaron son "doc.md"

    Escenario: El segundo build no cambia nada
      Dado que la raíz del proyecto está vacía
      Y un proyecto con un documento
      Cuando descubro el proyecto
      Cuando descubro el proyecto
      Entonces nada cambió

    Escenario: Sin título en el frontmatter se avisa
      Dado que la raíz del proyecto está vacía
      Y un proyecto con un documento
      Y aparece un documento sin título en el frontmatter
      Cuando descubro el proyecto mirando stderr
      Entonces stderr dice:
        """
        sin-titulo.md
        no tiene título
        Sin título
        """

  Regla de negocio: El `touch` no dispara un rebuild

    Escenario: Tocar un archivo no lo cambia
      Dado que la raíz del proyecto está vacía
      Y un proyecto con un documento
      Cuando descubro el proyecto
      Entonces el documento se toca 60 segundos en el futuro
      Cuando descubro el proyecto
      Y nada cambió
      Cuando descubro el proyecto
      Y nada cambió

    Escenario: El mtime del toque queda persistido (#2188)
      Dado que la raíz del proyecto está vacía
      Y un proyecto con un documento
      Cuando descubro el proyecto
      Entonces anoto el estado persistido
      Y el documento se toca 60 segundos en el futuro
      Cuando descubro el proyecto
      Y el mtime persistido es el del toque
      Y el hash persistido NO cambió
      Cuando descubro el proyecto
      Y nada cambió

    Escenario: Un clon reescrito con el mismo contenido no cambia nada
      Dado que la raíz del proyecto está vacía
      Y un proyecto con un documento
      Cuando descubro el proyecto
      Entonces el documento se reescribe con el mismo contenido 240 segundos después
      Cuando descubro el proyecto
      Y nada cambió

  Regla de negocio: Los cambios de verdad sí se ven

    Escenario: Un cambio del mismo tamaño se detecta por el hash
      Dado que la raíz del proyecto está vacía
      Y un proyecto con un documento
      Cuando descubro el proyecto
      Entonces el documento cambia por uno del mismo tamaño
      Y el documento se toca 120 segundos en el futuro
      Cuando descubro el proyecto
      Y los documentos que cambiaron son "doc.md"

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

    Escenario: Un documento borrado se marca y entra en los borrados
      Dado que la raíz del proyecto está vacía
      Y un proyecto con un documento
      Cuando descubro el proyecto
      Entonces se borra el documento
      Cuando descubro el proyecto
      Y los documentos que cambiaron son "doc.md"
      Y "doc.md" está en los borrados