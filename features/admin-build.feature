Característica: el build publica el admin de Sveltia

  Como quien administra el sitio
  Quiero que la carpeta admin se copie al sitio generado
  Para no mantener un script aparte

  Regla de negocio: admin/ se copia a dist/files cuando el HTML está activo

    Escenario: Copia la carpeta completa
      Dado que la raíz del proyecto está vacía
      Y el proyecto produce html
      Y que el archivo "texto.md" tiene este contenido
        """
        ---
        title: Texto
        ---

        Cuerpo.
        """
      Y que el archivo "admin/index.html" tiene este contenido
        """
        <!doctype html><title>Admin</title>
        """
      Y que el archivo "admin/config.yml" tiene este contenido
        """
        backend:
          name: github
        """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el sitio generado tiene el archivo "admin/index.html"
      Y el sitio generado tiene el archivo "admin/config.yml"
      Y el sitio generado tiene "admin/index.html" con "Admin"

    Escenario: No copia nada si el HTML está apagado
      Dado que la raíz del proyecto está vacía
      Y que el archivo "iteraciones.config.yaml" tiene este contenido
        """
        language: es-MX
        format:
          html:
            generate: false
        """
      Y que el archivo "texto.md" tiene este contenido
        """
        ---
        title: Texto
        ---

        Cuerpo.
        """
      Y que el archivo "admin/index.html" tiene este contenido
        """
        <!doctype html><title>Admin</title>
        """
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el sitio generado no tiene el archivo "admin/index.html"

    Escenario: Un build incremental vuelve a copiar los cambios del admin
      Dado que la raíz del proyecto está vacía
      Y el proyecto produce html
      Y que el archivo "texto.md" tiene este contenido
        """
        ---
        title: Texto
        ---

        Cuerpo.
        """
      Y que el archivo "admin/index.html" tiene este contenido
        """
        <!doctype html><title>Primera versión</title>
        """
      Cuando hago un build del proyecto
      Y que el archivo "admin/index.html" tiene este contenido
        """
        <!doctype html><title>Segunda versión</title>
        """
      Y hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el sitio generado tiene "admin/index.html" con "Segunda versión"
