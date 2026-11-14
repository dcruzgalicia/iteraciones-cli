Característica: el build no requiere minify

  Como quien publica HTML sin herramientas opcionales
  Quiero que el build siga aunque falte minify
  Para no instalar algo que sólo minifica la salida

  Regla de negocio: sin minify el HTML sale sin minificar y el build sigue

    Escenario: Un proyecto HTML compila sin minify
      Dado que la raíz del proyecto está vacía
      Y el proyecto produce html
      Y que el archivo "texto.md" tiene este contenido
        """
        ---
        title: Texto
        ---

        Contenido.
        """
      Cuando hago un build sin minify
      Entonces el comando termina con el código de salida 0
      Y la salida dice "minify no está en PATH"
      Y la salida menciona "minify no está en PATH" una sola vez
      Y el sitio generado tiene el archivo "index.html"
      Y el sitio generado tiene el archivo "texto.html"
