# language: es
Característica: limpiar el párrafo de un hallazgo tipográfico

  Como quien corrige el markdown después de revisar el PDF
  Quiero que --clean deje limpio el párrafo del hallazgo
  Para quitar los &nbsp;, los spans y los divs de ajuste sin tocar el resto

  Regla de negocio: --clean con números limpia sólo las incidencias elegidas

    Escenario: Limpia el párrafo elegido y deja los otros
      Dado que la raíz del proyecto está vacía
      Y que la raíz del proyecto es un repositorio git
      Y el PDF "dist/files/libro.pdf" con estas páginas:
        """
        Volvi a la casa de mis padres un martes
        Adios
        texto que sigue con palabras
        \f
        """
      Y que el archivo "libro.md" tiene este contenido
        """
        ---
        title: Libro
        ---

        Primer párrafo que no se toca con un&nbsp;espacio y [una frase]{.text-nowrap} que se queda.

        ::: {runt=3}
        Volvi a la casa de mis padres un martes&nbsp;Adios con [una palabra]{.text-nowrap} y más texto que sigue.
        :::

        ::: {shrink=2}
        Otra linea con muchas palabras y [otra frase]{.text-nowrap} que tampoco se toca.
        :::
        """
      Cuando parseo el comando "typography dist/files/libro.pdf --rules single-word-line --clean 1" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 0
      Y la salida dice "1 párrafos limpios de 1"
      Y el archivo "libro.md" contiene "un&nbsp;espacio"
      Y el archivo "libro.md" contiene "martes Adios"
      Y el archivo "libro.md" contiene "con una palabra y"
      Y el archivo "libro.md" no contiene "::: {runt=3}"
      Y el archivo "libro.md" contiene "::: {shrink=2}"
      Y el archivo "libro.md" contiene "[otra frase]{.text-nowrap}"

  Regla de negocio: --clean sin números limpia todos los hallazgos

    Escenario: Limpia los párrafos de todas las incidencias
      Dado que la raíz del proyecto está vacía
      Y que la raíz del proyecto es un repositorio git
      Y el PDF "dist/files/libro.pdf" con estas páginas:
        """
        Volvi a la casa de mis padres un martes
        Adios
        texto que sigue con palabras
        \f
        Otra linea con muchas palabras
        Bien
        mas texto que sigue aqui
        \f
        """
      Y que el archivo "libro.md" tiene este contenido
        """
        ---
        title: Libro
        ---

        ::: {runt=3}
        Volvi a la casa de mis padres un martes&nbsp;Adios con [una palabra]{.text-nowrap}.
        :::

        ::: {stretch=2}
        Otra linea con muchas palabras&nbsp;Bien y [otra frase]{.text-no-wrap}.
        :::
        """
      Cuando parseo el comando "typography dist/files/libro.pdf --rules single-word-line --clean" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 0
      Y la salida dice "2 párrafos limpios de 2"
      Y el archivo "libro.md" no contiene "&nbsp;"
      Y el archivo "libro.md" no contiene "{.text-nowrap}"
      Y el archivo "libro.md" no contiene "{.text-no-wrap}"
      Y el archivo "libro.md" no contiene ":::"
      Y el archivo "libro.md" contiene "martes Adios"
      Y el archivo "libro.md" contiene "palabras Bien"

  Regla de negocio: El número sale del informe y no se inventa

    Escenario: --clean con un número que no existe lo dice
      Dado que la raíz del proyecto está vacía
      Y que la raíz del proyecto es un repositorio git
      Y el PDF "dist/files/libro.pdf" con estas páginas:
        """
        uno dos.
        tres cuatro.
        \f
        """
      Cuando parseo el comando "typography dist/files/libro.pdf --clean 9" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 1
      Y el error dice "no existe la incidencia 9"

    Escenario: Sin repositorio git lo dice
      Dado que la raíz del proyecto está vacía
      Cuando parseo el comando "typography dist/files/libro.pdf --clean" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 1
      Y el error dice "typography --clean requiere un repositorio git"

  Regla de negocio: --clean y --fix no se mezclan

    Escenario: Pedir los dos lo dice
      Dado que la raíz del proyecto está vacía
      Y que la raíz del proyecto es un repositorio git
      Y el PDF "dist/files/libro.pdf" con estas páginas:
        """
        uno dos.
        tres cuatro.
        \f
        """
      Cuando parseo el comando "typography dist/files/libro.pdf --clean --fix" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 1
      Y el error dice "--clean y --fix no se combinan"
