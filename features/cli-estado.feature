# language: es
Característica: Un build a medias no envenena la caché ni pierde documentos

  Como quien corta un build con Ctrl-C y vuelve a correrlo
  Quiero que el siguiente build reprocese en vez de reutilizar a medias
  Para no publicar medio proyecto y no perder un documento

  Regla de negocio: Un type sin cuerpo propio sigue siendo válido

    Escenario: Una collection sin cuerpo propio es válida
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Dado que el archivo "coleccion.md" tiene este contenido
      """
      ---
      title: Antología
      type: collection
      files:
        - test.md
      ---
      """
      Dado que el archivo "intervencion.md" tiene este contenido
      """
      ---
      title: Intervención
      type: intervention
      ---
      """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y valido el proyecto pidiendo JSON
      Y el JSON declara que no hay ni un error
      Y el JSON no declara avisos sobre "coleccion.md, intervencion.md"

    Escenario: Un miembro vacío de una collection rompe build y validate
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Dado que el archivo "index.md" tiene este contenido
      """
      ---
      title: Antología
      type: collection
      files:
        - test.md
        - vacio.md
      ---
      """
      Dado que el archivo "vacio.md" tiene este contenido
      """
      ---
      title: Vacío
      ---
      """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 1
      Y el error dice "vacio.md"
      Y el error dice "agrega un body para proceder con el build"
      Y validate dice lo mismo sobre el documento "vacio.md"

  Regla de negocio: Un build fallido no envenena la caché

    Escenario: El documento arreglado se reprocesa
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Dado que el archivo "vacio.md" tiene este contenido
      """
      ---
      title: [roto
      ---

      Contenido.
      """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 1
      Dado que el archivo "vacio.md" tiene este contenido
      """
      ---
      title: Vacío
      ---

      Ahora sí tiene contenido.
      """
      Y hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el build reprocesa los documentos

    Escenario: Un estado sin completar no sirve de caché
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Cuando hago un build del proyecto
      Dado que el build deja el estado sin marcar como completado
      Y hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el build reprocesa los documentos

    Escenario: El build siguiente al que se reparó vuelve a reutilizar
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Cuando hago un build del proyecto
      Dado que el build deja el estado sin marcar como completado
      Y hago un build del proyecto
      Y hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el build reutiliza la salida

  Regla de negocio: El error de pandoc nombra el documento una sola vez

    Escenario: Un filtro lua roto nombra el documento una sola vez
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Dado que la raíz del proyecto tiene un filtro lua con sintaxis rota
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 1
      Y el error nombra el documento una sola vez
      Y el error no dice "pandoc falló al convertir test.md"