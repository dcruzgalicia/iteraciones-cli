# language: es
Característica: la tarjeta de licencia del sitio

  Como quien publica el sitio
  Quiero una tarjeta automática con la licencia del proyecto o del documento
  Para que los derechos queden claros en todas las páginas

  Regla de negocio: La licencia se declara en la configuración o en el frontmatter

    Escenario: Con CC-BY-NC-ND-4.0 aparece la licencia en el sidebar
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y que el archivo "iteraciones.config.yaml" tiene este contenido
        """
        language: es-MX
        format:
          html:
            generate: true
            site:
              title: Historikas
              license: CC-BY-NC-ND-4.0
        """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/index.html" dice "Algunos derechos reservados."
      Y el archivo "dist/files/index.html" dice ">Licencia</h2>"
      Y el archivo "dist/files/index.html" no dice "mb-2 flex items-center gap-2"
      Y el archivo "dist/files/index.html" dice "my-0!"
      Y el archivo "dist/files/index.html" dice "brindar un enlace a la&nbsp;licencia"
      Y el archivo "dist/files/index.html" pone "Algunos derechos reservados." antes que "card-identity-footer"
      Y el archivo "dist/files/assets/images/cc.webp" existe
      Y el archivo "dist/files/assets/images/by.webp" existe
      Y el archivo "dist/files/assets/images/nc.webp" existe
      Y el archivo "dist/files/assets/images/nd.webp" existe

    Escenario: Solo se copian los iconos de la licencia en uso
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el proyecto produce html
      Cuando hago un build del proyecto
      Entonces el archivo "dist/files/assets/images/cc.webp" existe
      Y el archivo "dist/files/assets/images/pf.webp" no existe
      Y el archivo "dist/files/assets/images/ac.webp" no existe

    Escenario: Con dos licencias se copian todos los iconos
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el proyecto produce html
      Y que el archivo "pf.md" tiene este contenido
        """
        ---
        title: PF
        license: PF-AC-PR-FA-1.0
        ---

        Cuerpo.
        """
      Cuando hago un build del proyecto
      Entonces el archivo "dist/files/assets/images/cc.webp" existe
      Y el archivo "dist/files/assets/images/pf.webp" existe
      Y el archivo "dist/files/assets/images/ac.webp" existe

    Escenario: Sin licencia no se copian iconos
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y que el archivo "iteraciones.config.yaml" tiene este contenido
        """
        language: es-MX
        license: false
        format:
          html:
            generate: true
        """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/assets/images/cc.webp" no existe

    Escenario: La licencia va en el sidebar antes de las redes
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y que el archivo "iteraciones.config.yaml" tiene este contenido
        """
        language: es-MX
        format:
          html:
            generate: true
            site:
              title: Historikas
              license: CC-BY-NC-ND-4.0
              links:
                - name: Facebook
                  url: https://facebook.com/x
        """
      Y que el archivo "un-texto.md" tiene este contenido
        """
        ---
        title: Un texto
        keywords:
          - memoria
        ---

        Cuerpo del texto.
        """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/un-texto.html" pone "Palabras clave" antes que "Algunos derechos reservados."
      Y el archivo "dist/files/un-texto.html" pone "items-center gap-1.5 rounded-md border-2 border-stone-500/60 bg-transparent" antes que "Algunos derechos reservados."
      Y la licencia de "dist/files/un-texto.html" va antes de la segunda Redes

    Escenario: Los iconos se referencian desde cada página
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y que el archivo "iteraciones.config.yaml" tiene este contenido
        """
        language: es-MX
        format:
          html:
            generate: true
            site:
              title: Historikas
              license: CC-BY-NC-ND-4.0
        """
      Y una colección en "convocatorias" con 1 miembros
      Cuando hago un build del proyecto
      Entonces el archivo "dist/files/convocatorias/antologia.html" dice "src=\"./../assets/images/cc.webp\""
      Y el archivo "dist/files/convocatorias/antologia.html" dice "width:32px;height:32px"

    Escenario: Sin licencia configurada se muestra la CC por defecto
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el proyecto produce html
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/index.html" dice ">Licencia</h2>"
      Y el archivo "dist/files/index.html" dice "Algunos derechos reservados."
      Y el archivo "dist/files/index.html" dice "Licencia Creative Commons"
      Y el archivo "dist/files/index.html" dice "brindar un enlace a la&nbsp;licencia"
      Y el archivo "dist/files/index.html" dice "No puede hacer uso de esta obra con propósitos comerciales"
      Y el archivo "dist/files/index.html" pone "assets/images/cc.webp" antes que "assets/images/by.webp"
      Y el archivo "dist/files/index.html" pone "assets/images/by.webp" antes que "assets/images/nc.webp"
      Y el archivo "dist/files/index.html" pone "assets/images/nc.webp" antes que "assets/images/nd.webp"
      Y el archivo "dist/files/assets/images/cc.webp" existe
      Y el archivo "dist/files/assets/images/by.webp" existe
      Y el archivo "dist/files/assets/images/nc.webp" existe
      Y el archivo "dist/files/assets/images/nd.webp" existe

    Escenario: La clave license del nivel superior elige la licencia del proyecto
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y que el archivo "iteraciones.config.yaml" tiene este contenido
        """
        language: es-MX
        license: cc-by-nc-nd-4.0
        format:
          html:
            generate: true
            site:
              title: Test
        """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/index.html" dice "Licencia Creative Commons"
      Y el archivo "dist/files/index.html" dice "assets/images/cc.webp"
      Y el archivo "dist/files/index.html" no dice "Licencia de Producción Feminista"

    Escenario: El frontmatter del documento gana sobre la licencia del sitio
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y que el archivo "iteraciones.config.yaml" tiene este contenido
        """
        language: es-MX
        license: PF-AC-PR-FA-1.0
        format:
          html:
            generate: true
            site:
              title: Test
        """
      Y que el archivo "un-texto.md" tiene este contenido
        """
        ---
        title: Un texto
        license: CC-BY-NC-ND-4.0
        ---

        Cuerpo del texto.
        """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/un-texto.html" dice "Licencia Creative Commons"
      Y el archivo "dist/files/un-texto.html" dice "assets/images/cc.webp"
      Y el archivo "dist/files/index.html" dice "Licencia de Producción Feminista"
