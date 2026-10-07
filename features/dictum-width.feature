# language: es
Característica: el ancho de los dictum

  Como quien escribe texto corrido en la página
  Quiero que un ancho imposible avise antes de imprimir
  Para no descubrirlo en el PDF

  Regla de negocio: El body salta las cercas de código

    Escenario: Un ancho dentro de una cerca no es un ancho
      Dado que la raíz del proyecto está vacía
      Y un documento con dictums dentro y fuera de una cerca de código
      Cuando escaneo los anchos del body
      Entonces los anchos fuera de rango son:
        """
        5 ;; línea 1
        """

    Escenario: El fragmento YAML no salta nada
      Dado que la raíz del proyecto está vacía
      Y un documento con dictums dentro y fuera de una cerca de código
      Cuando escaneo los anchos del fragmento YAML
      Entonces los anchos fuera de rango son:
        """
        5 ;; línea 1
        9 ;; línea 4
        """

  Regla de negocio: El rango va de 0.1 a 1.0

    Escenario: Los anchos dentro del rango no avisan
      Dado que la raíz del proyecto está vacía
      Y el texto:
        """
        ::: {.dictum width=0.5}
        ::: {.dictum width=0.1}
        ::: {.dictum width=1}
        """
      Cuando escaneo los anchos del body
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

    Escenario: El número de línea se desplaza con el offset
      Dado que la raíz del proyecto está vacía
      Y un documento con dictums dentro y fuera de una cerca de código
      Y el desplazamiento de línea es 10
      Cuando escaneo los anchos del body
      Entonces los anchos fuera de rango son:
        """
        5 ;; línea 11
        """

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

    Escenario: Un ancho entrecomillado no se detecta
      Dado que la raíz del proyecto está vacía
      Y el texto:
        """
        ::: {#d .dictum width="7"}
        """
      Cuando escaneo los anchos del body
      Entonces no hay ningún ancho fuera de rango