# language: es
Característica: la tarjeta de licencia del sitio

  Como quien publica el sitio
  Quiero una tarjeta automática con la licencia Creative Commons
  Para que los derechos queden claros en todas las páginas

  Regla de negocio: La licencia se declara en la configuración del sitio

    Escenario: Con CC-BY-NC-ND-4.0 aparece la tarjeta antes del footer
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
      Y el archivo "dist/files/index.html" dice "brindar un enlace a la&nbsp;licencia"
      Y el archivo "dist/files/index.html" pone "Algunos derechos reservados." antes que "card-identity-footer"
      Y el archivo "dist/files/assets/images/cc.svg" existe
      Y el archivo "dist/files/assets/images/by.svg" existe
      Y el archivo "dist/files/assets/images/nc.svg" existe
      Y el archivo "dist/files/assets/images/nd.svg" existe

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
      Entonces el archivo "dist/files/convocatorias/antologia.html" dice "src=\"./../assets/images/cc.svg\""
      Y el archivo "dist/files/convocatorias/antologia.html" dice "width:15pt"

    Escenario: Sin licencia no hay tarjeta
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el proyecto produce html
      Cuando hago un build del proyecto
      Entonces el archivo "dist/files/index.html" no dice "Algunos derechos reservados."
