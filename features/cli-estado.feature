# language: es
Característica: Un build a medias no envenena la caché ni pierde documentos

  Como quien corta un build con Ctrl-C y vuelve a correrlo
  Quiero que el siguiente build reprocese en vez de reutilizar a medias
  Para no publicar medio proyecto y no perder un documento

  # Tramo 1 de la migración. 5 de los 21 casos que quedan de `cli-layer`.
  #
  # Los cinco son el mismo negocio: **el estado y la caché se escriben al final
  # del build**. Un build que falla o que se interrumpe deja el proyecto en un
  # estado que el siguiente build tiene que volver a hacer, no servido de caché.

  Regla de negocio: Un type sin cuerpo propio sigue siendo válido

    # `collection` e `intervention` son contenedores: su cuerpo lo arman sus
    # miembros, no el documento. Exigirles un body propio los volvería inválidos
    # siempre, y el autor no tiene cómo arreglarlo.

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

    # El otro lado: un MIEMBRO vacío sí rompe. Y rompe igual en `build` y en
    # `validate`, con el mismo texto — si sólo lo detectara el build, el autor
    # que usa `validate` para evitar un build largo no se entera hasta que
    # compila.

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

    # El frontmatter roto se detecta en `discover`, antes del pipeline. El
    # documento queda marcado como fallido y el estado no se escribe. Si el
    # build siguiente lo sirviera de caché, el arreglo del autor no se vería
    # nunca — y el escenario sería un falso verde.

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

    # El estado se marca `completed` al final. Un build interrumpido a mitad de
    # render deja el estado sin marcar, así que **no es caché válida**: el
    # siguiente build rehace todo aunque no haya cambiado nada.

    # El cuerpo del documento es idéntico en los dos builds: el estado sin
    # completar tiene que invalidar la caché por sí mismo. Si lo que invalidara
    # fuera el hash del documento, el scenario pasaría con la guarda quitada —
    # que es exactamente lo que hacía la aserción que se descartó.

    Escenario: Un estado sin completar no sirve de caché
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Cuando hago un build del proyecto
      Dado que el build deja el estado sin marcar como completado
      Y hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el build reprocesa los documentos

    # Y una vez reescrito bien, el camino normal vuelve: el tercer build sí
    # reutiliza. Si el segundo hubiera dejado el estado otra vez sin marcar,
    # el tercero reprocesaría también y esta aserción lo delata.

    Escenario: El build siguiente al que se reparó vuelve a reutilizar
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Cuando hago un build del proyecto
      Dado que el build deja el estado sin marcar como completado
      Y hago un build del proyecto
      Y hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el build reutiliza la salida

  Regla de negocio: El error de pandoc nombra el documento una sola vez

    # El mensaje de pandoc ya trae la ruta del archivo. El wrapper la agrega
    # delante, una vez. Si apareciera dos veces —una en el texto de pandoc y otra
    # en el prefijo— el usuario leería dos rutas distintas para el mismo fallo.

    Escenario: Un filtro lua roto nombra el documento una sola vez
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Dado que la raíz del proyecto tiene un filtro lua con sintaxis rota
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 1
      Y el error nombra el documento una sola vez
      Y el error no dice "pandoc falló al convertir test.md"