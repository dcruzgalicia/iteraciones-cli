Característica: imagen de build para GitLab CI

  Como quien mantiene el pipeline
  Quiero una imagen con las herramientas del build
  Para no instalarlas en cada job

  Regla de negocio: La imagen usa paquetes nativos, no Homebrew

    Escenario: El Dockerfile trae Bun, pandoc, ImageMagick y librsvg
      Dado que la raíz del proyecto está vacía
      Entonces el Dockerfile de build usa paquetes nativos y no Homebrew
