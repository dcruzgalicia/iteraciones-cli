# language: es
@requires-pandoc
Característica: limpiar las marcas tipográficas del markdown de origen

  Como quien mantiene los textos
  Quiero quitar del markdown las marcas de ajuste que sólo sirven para el PDF
  Para no tener que exportar y copiar el markdown de dist a mano

  Regla de negocio: El clean quita lo mismo que el export

    Escenario: Quita shrink, stretch, runt, text-nowrap y espacios duros
      Dado que la raíz del proyecto está vacía
      Y que el archivo "texto.md" tiene este contenido
        """
        ---
        title: Un texto
        ---

        Texto con&nbsp;espacio y [una frase]{.text-nowrap} y &#160; y &#xa0; y más.

        ::: {shrink=20}
        Texto apretado.
        :::

        ::: {stretch=30}
        Texto separado.
        :::

        ::: {runt=2}
        Texto con runt.
        :::
        """
      Cuando parseo el comando "clean-markdown texto.md" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 0
      Y la salida dice "1 markdown limpio de 1"
      Y el archivo "texto.md" contiene "title: Un texto"
      Y el archivo "texto.md" contiene "Texto con espacio y una frase y y y más."
      Y el archivo "texto.md" no contiene "&nbsp;"
      Y el archivo "texto.md" no contiene "&#160;"
      Y el archivo "texto.md" no contiene "&#xa0;"
      Y el archivo "texto.md" no contiene ".text-nowrap"
      Y el archivo "texto.md" no contiene "shrink"
      Y el archivo "texto.md" no contiene "stretch"
      Y el archivo "texto.md" no contiene "runt="

    Escenario: Cada párrafo queda en una sola línea
      Dado que la raíz del proyecto está vacía
      Y que el archivo "texto.md" tiene este contenido
        """
        ---
        title: Un texto
        ---

        Este párrafo está
        partido en varias
        líneas.
        """
      Cuando parseo el comando "clean-markdown texto.md" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "texto.md" contiene "Este párrafo está partido en varias líneas."
      Y el archivo "texto.md" contiene "title: Un texto"

  Regla de negocio: El clean no toca lo que el export no quita

    Escenario: Las marcas de presentación y las formas viejas se quedan
      Dado que la raíz del proyecto está vacía
      Y que el archivo "texto.md" tiene este contenido
        """
        ---
        title: Un texto
        ---

        Texto [sin cortes]{.text-no-wrap}, [guiones]{.hyphens-none} y [mayúsculas]{.uppercase}.

        ::: {line-height=1.5}
        Texto con interlineado.
        :::

        ::: {.text-center}
        Texto centrado.
        :::

        ::: {.text-lg}
        Texto grande.
        :::

        ::: {br=1}
        :::

        ::: {.indent-2}
        Texto con sangría.
        :::

        Texto [viejo]{.mbox} que el CLI ya no reconoce.
        """
      Cuando parseo el comando "clean-markdown texto.md" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "texto.md" contiene ".text-no-wrap"
      Y el archivo "texto.md" contiene ".hyphens-none"
      Y el archivo "texto.md" contiene ".uppercase"
      Y el archivo "texto.md" contiene "line-height"
      Y el archivo "texto.md" contiene "text-center"
      Y el archivo "texto.md" contiene "text-lg"
      Y el archivo "texto.md" contiene "br="
      Y el archivo "texto.md" contiene "indent-2"
      Y el archivo "texto.md" contiene ".mbox"

  Regla de negocio: --check no escribe

    Escenario: Con cambios, avisa y sale con código 1
      Dado que la raíz del proyecto está vacía
      Y que el archivo "texto.md" tiene este contenido
        """
        Texto con&nbsp;espacio.
        """
      Cuando parseo el comando "clean-markdown --check texto.md" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 1
      Y la salida dice "se limpiarían 1 archivo"
      Y el archivo "texto.md" contiene "&nbsp;"

    Escenario: La segunda pasada no cambia nada
      Dado que la raíz del proyecto está vacía
      Y que el archivo "texto.md" tiene este contenido
        """
        Texto limpio.
        """
      Cuando parseo el comando "clean-markdown texto.md" sobre la raíz del proyecto
      Y parseo el comando "clean-markdown texto.md" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 0
      Y la salida dice "markdown ya limpio"
      Y el archivo "texto.md" contiene "Texto limpio."
