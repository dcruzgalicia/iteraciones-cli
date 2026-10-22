# language: es
Característica: las portadas del PDF

  Como quien diseña un libro
  Quiero una portada por delante y otra por detrás del startpaper
  Para que el libro tenga las tres hojas de guarda

  Regla de negocio: Las portadas ocupan las primeras páginas

    Escenario: Con las tres, cada una ocupa su página
      Dado que la raíz del proyecto está vacía
      Y el proyecto tiene un libro
      Y el libro lleva la portada "frontCover"
      Y el libro lleva la portada "backCover"
      Y el libro lleva la portada "startpaper"
      Cuando compilo el proyecto del libro para leer su LaTeX
      Entonces el LaTeX del libro llama a "\setcover"
      Y el LaTeX del libro tiene "\setstartpaper{"
      Y el LaTeX del libro llama a las guardas antes del título:
      """
      \ifcase\l@covercount
      """

    Escenario: El startpaper sigue siendo la guarda cuando no hay más
      Dado que la raíz del proyecto está vacía
      Y el proyecto tiene un libro
      Y el libro lleva la portada "startpaper"
      Cuando compilo el proyecto del libro para leer su LaTeX
      Entonces el LaTeX del libro tiene "\setstartpaper{"
      Y el LaTeX del libro no llama a "\setcover"

  Regla de negocio: Las guardas pueden ir en color

    Escenario: Con coverColor las guardas conservan su color
      Dado que la raíz del proyecto está vacía
      Y el proyecto tiene un libro
      Y el libro lleva la portada "frontCover"
      Y el libro lleva las guardas en color
      Y el proyecto compila el PDF
      Entonces la página 1 del PDF conserva el color

    Escenario: Sin coverColor las guardas van en escala de grises
      Dado que la raíz del proyecto está vacía
      Y el proyecto tiene un libro
      Y el libro lleva la portada "frontCover"
      Y el proyecto compila el PDF
      Entonces la página 1 del PDF está en escala de grises

  Regla de negocio: El PDF sale con las portadas en su página

    Escenario: Las tres portadas son las tres primeras páginas
      Dado que la raíz del proyecto está vacía
      Y el proyecto tiene un libro
      Y el libro lleva la portada "frontCover"
      Y el libro lleva la portada "backCover"
      Y el libro lleva la portada "startpaper"
      Y el proyecto compila el PDF
      Entonces el PDF del libro tiene 5 páginas
      Y la página 1 del PDF es "frontCover"
      Y la página 2 del PDF es "backCover"
      Y la página 3 del PDF es "startpaper"

    Escenario: Con un solo startpaper, la guarda sigue siendo la primera
      Dado que la raíz del proyecto está vacía
      Y el proyecto tiene un libro
      Y el libro lleva la portada "startpaper"
      Y el proyecto compila el PDF
      Entonces el PDF del libro tiene 3 páginas
      Y la página 1 del PDF es "startpaper"

    Escenario: El epígrafe no se monta encima de las guardas
      Dado que la raíz del proyecto está vacía
      Y el proyecto tiene un libro
      Y el libro lleva la portada "frontCover"
      Y el libro lleva la portada "backCover"
      Y el libro lleva la portada "startpaper"
      Y el libro lleva el epígrafe "Un epígrafe de apertura"
      Y el proyecto compila el PDF
      Entonces la página 1 del PDF no dice "Un epígrafe de apertura"
      Y la página 2 del PDF no dice "Un epígrafe de apertura"
      Y la página 3 del PDF no dice "Un epígrafe de apertura"

    Escenario: Con sólo startpaper hay una sola página en blanco antes del epígrafe
      Dado que la raíz del proyecto está vacía
      Y el proyecto tiene un libro
      Y el libro lleva la portada "startpaper"
      Y el libro lleva el epígrafe "Un epígrafe de apertura"
      Y el proyecto compila el PDF
      Entonces la página 1 del PDF es "startpaper"
      Y la página 2 del PDF no dice "Un epígrafe de apertura"
      Y la página 3 del PDF dice "Un epígrafe de apertura"

    Escenario: El epígrafe va en un recto, con su verso en blanco
      Dado que la raíz del proyecto está vacía
      Y el proyecto tiene un libro
      Y el libro lleva la portada "frontCover"
      Y el libro lleva la portada "startpaper"
      Y el libro lleva el epígrafe "Un epígrafe de apertura"
      Y el proyecto compila el PDF
      Entonces la página 5 del PDF dice "Un epígrafe de apertura"
      Y la página 6 del PDF no dice "Un epígrafe de apertura"
      Y la página 7 del PDF dice "UN LIBRO"

    Escenario: El epígrafe va en su propia página, después de las guardas
      Dado que la raíz del proyecto está vacía
      Y el proyecto tiene un libro
      Y el libro lleva la portada "frontCover"
      Y el libro lleva la portada "backCover"
      Y el libro lleva la portada "startpaper"
      Y el libro lleva el epígrafe "Un epígrafe de apertura"
      Y el proyecto compila el PDF
      Entonces la página 5 del PDF dice "Un epígrafe de apertura"
