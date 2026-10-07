# language: es
Característica: el ancho de los dictum

  Como quien escribe texto corrido en la página
  Quiero que un ancho imposible avise antes de imprimir
  Para no descubrirlo en el PDF

  # Tramo 52 de la migración. 6 de los 6 casos de `dictum-width.test.ts`. El
  # archivo queda cerrado.

  # Dos modos y un solo escáner: el body de un documento trae cercas de código, y
  # un `width=5` dentro de un ejemplo es contenido, no configuración. El fragmento
  # YAML que se le pasa ya viene limpio, así que ahí se cuenta todo (#2500
  # unificó los dos escáneres).

  Regla de negocio: El body salta las cercas de código

    Escenario: Un ancho dentro de una cerca no es un ancho
      Dado que la raíz del proyecto está vacía
      Y un documento con dictums dentro y fuera de una cerca de código
      Cuando escaneo los anchos del body
      # La línea 4 es el ejemplo de código: no avisa.
      Entonces los anchos fuera de rango son:
        """
        5 ;; línea 1
        """

    # En el fragmento YAML no hay cercas: todo lo que haya es configuración.
    Escenario: El fragmento YAML no salta nada
      Dado que la raíz del proyecto está vacía
      Y un documento con dictums dentro y fuera de una cerca de código
      Cuando escaneo los anchos del fragmento YAML
      # Ahora sí cuenta la línea 4.
      Entonces los anchos fuera de rango son:
        """
        5 ;; línea 1
        9 ;; línea 4
        """

  Regla de negocio: El rango va de 0.1 a 1.0

    # Un dictum es texto corrido: un ancho de 5 caracteres no cabe nada, y uno de
    # 1.5 "caracteres" no es un ancho.

    Escenario: Los anchos dentro del rango no avisan
      Dado que la raíz del proyecto está vacía
      Y el texto:
        """
        ::: {.dictum width=0.5}
        ::: {.dictum width=0.1}
        ::: {.dictum width=1}
        """
      Cuando escaneo los anchos del body
      # Los tres extremos del rango válido.
      Entonces no hay ningún ancho fuera de rango

    Escenario: Los anchos fuera del rango avisan
      Dado que la raíz del proyecto está vacía
      Y el texto:
        """
        ::: {.dictum width=0.05}
        ::: {.dictum width=1.5}
        """
      Cuando escaneo los anchos del body
      Entonces los anchos fuera de rango son:
        """
        0.05 ;; línea 1
        1.5 ;; línea 2
        """

    # El aviso lleva el número de línea real del archivo, no el del fragmento:
    # si no, el autor busca en la línea equivocada.
    Escenario: El número de línea se desplaza con el offset
      Dado que la raíz del proyecto está vacía
      Y un documento con dictums dentro y fuera de una cerca de código
      Y el desplazamiento de línea es 10
      Cuando escaneo los anchos del body
      Entonces los anchos fuera de rango son:
        """
        5 ;; línea 11
        """

    # La clase no importa: lo que cuenta es que sea un dictum con `width`.
    Escenario: Se aceptan otras clases dentro de la valla
      Dado que la raíz del proyecto está vacía
      Y el texto:
        """
        ::: {#d .dictum width=7}
        """
      Cuando escaneo los anchos del body
      Entonces los anchos fuera de rango son:
        """
        7 ;; línea 1
        """

    # La regex exige dígitos justo después del `=`, así que `width="7"` escapa.
    # Está aquí para que un cambio de regex sea DELIBERADO: si alguien la
    # ensancha, este escenario falla y pregunta por qué cambió, en vez de
    # aceptarlo sin mirar.
    Escenario: Un ancho entrecomillado no se detecta
      Dado que la raíz del proyecto está vacía
      Y el texto:
        """
        ::: {#d .dictum width="7"}
        """
      Cuando escaneo los anchos del body
      # Comportamiento actual de la regex, fijado a propósito.
      Entonces no hay ningún ancho fuera de rango