# language: es
Característica: la licencia en los formatos exportados

  Como quien publica el proyecto en varios formatos
  Quiero que la licencia viaje también al EPUB, LaTeX, PDF y markdown
  Para que los derechos queden claros fuera del HTML

  Regla de negocio: La licencia por defecto es Creative Commons

    Escenario: La licencia CC va en LaTeX, EPUB y markdown
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y que el archivo "iteraciones.config.yaml" tiene este contenido
        """
        language: es-MX
        format:
          latex:
            generate: true
          epub:
            generate: true
          markdown:
            generate: true
        """
      Y que el archivo "documento.md" tiene este contenido
        """
        ---
        title: Documento
        ---

        Cuerpo.
        """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/documento.tex" dice "lowertitleback"
      Y el archivo "dist/files/documento.tex" dice "Algunos derechos reservados"
      Y el archivo "dist/files/documento.tex" dice "assets/pdf/images/documento-cc.jpg"
      Y el archivo "dist/files/documento.md" dice "license: CC-BY-NC-ND-4.0"
      Y el archivo "dist/files/documento.md" dice "rights: Algunos derechos reservados."
      Y el EPUB "documento" contiene "Algunos derechos reservados"

  Regla de negocio: Un lowertitleback propio no se sustituye

    Escenario: El lowertitleback del proyecto gana
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y que el archivo "iteraciones.config.yaml" tiene este contenido
        """
        language: es-MX
        lowertitleback: "Mi contraportada"
        format:
          latex:
            generate: true
        """
      Y que el archivo "documento.md" tiene este contenido
        """
        ---
        title: Documento
        ---

        Cuerpo.
        """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/documento.tex" dice "Mi contraportada"
      Y el archivo "dist/files/documento.tex" no dice "Algunos derechos reservados"

    Escenario: El lowertitleback del archivo gana
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y que el archivo "iteraciones.config.yaml" tiene este contenido
        """
        language: es-MX
        format:
          latex:
            generate: true
        """
      Y que el archivo "documento.md" tiene este contenido
        """
        ---
        title: Documento
        lowertitleback: "Mi contraportada de archivo"
        ---

        Cuerpo.
        """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/documento.tex" dice "Mi contraportada de archivo"
      Y el archivo "dist/files/documento.tex" no dice "Algunos derechos reservados"

  Regla de negocio: La licencia elegida usa sus propios iconos

    Escenario: La licencia PF lleva sus iconos al lowertitleback
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y que el archivo "iteraciones.config.yaml" tiene este contenido
        """
        language: es-MX
        license: PF-AC-PR-FA-1.0
        format:
          latex:
            generate: true
        """
      Y que el archivo "documento.md" tiene este contenido
        """
        ---
        title: Documento
        ---

        Cuerpo.
        """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/documento.tex" dice "assets/pdf/images/documento-pf.jpg"
      Y el archivo "dist/files/documento.tex" dice "Producción Feminista"
