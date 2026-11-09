# language: es
Característica: init sveltia deja un proyecto listo para el admin

  Como quien publica un sitio con Sveltia
  Quiero que la CLI cree el admin, el layout y la configuración de Netlify
  Para no configurar Sveltia ni el despliegue a mano

  Regla de negocio: init sveltia crea el admin y el layout sin sobrescribir

    Escenario: Crea el admin y las carpetas sin contenido de ejemplo
      Dado que la raíz del proyecto está vacía
      Cuando corro "init sveltia"
      Entonces el comando termina con el código de salida 0
      Y el archivo "iteraciones.config.yaml" existe
      Y el archivo ".gitignore" existe
      Y el archivo "admin/index.html" existe
      Y el archivo "admin/config.yml" existe
      Y el archivo "admin/vendor/sveltia-cms.js" existe
      Y el archivo "palabras-clave/.gitkeep" existe
      Y el archivo "netlify.toml" existe
      Y el archivo "Brewfile.netlify" existe
      Y el archivo "index.md" no existe
      Y el archivo "menu.md" no existe
      Y el archivo "bibliography.bib" no existe
      Y el archivo "textos/ejemplo.md" no existe
      Y el archivo "creadoras/ejemplo.md" no existe
      Y el archivo "colecciones/ejemplo.md" no existe
      Y el archivo "listas/ejemplo.md" no existe
      Y el archivo "anuncios/ejemplo.md" no existe
      Y el archivo "intervenciones/ejemplo.md" no existe

    Escenario: La configuración de Sveltia cubre todos los types
      Dado que la raíz del proyecto está vacía
      Cuando corro "init sveltia"
      Entonces el comando termina con el código de salida 0
      Y la configuración de Sveltia usa el backend "github"
      Y la configuración de Sveltia declara la colección "textos" en la carpeta "textos"
      Y la configuración de Sveltia declara la colección "colecciones" en la carpeta "colecciones"
      Y la configuración de Sveltia declara la colección "creadoras" en la carpeta "creadoras"
      Y la configuración de Sveltia declara la colección "intervenciones" en la carpeta "intervenciones"
      Y la configuración de Sveltia declara la colección "listas" en la carpeta "listas"
      Y la configuración de Sveltia declara la colección "anuncios" en la carpeta "anuncios"
      Y la configuración de Sveltia declara el archivo "menu.md"
      Y la configuración de Sveltia declara el archivo "index.md"
      Y la configuración de Sveltia declara el campo "collectionCreator" en la colección "colecciones"
      Y la configuración de Sveltia declara el campo "placement" en la colección "anuncios"
      Y la configuración de Sveltia ofrece la licencia "CC-BY-NC-ND-4.0"
      Y la configuración de Sveltia ofrece la licencia "PF-AC-PR-FA-1.0"

    Escenario: La configuración sigue el layout de Histórikas
      Dado que la raíz del proyecto está vacía
      Cuando corro "init sveltia"
      Entonces el comando termina con el código de salida 0
      Y el campo "type" de la colección "menu" está oculto con el valor "menu"
      Y el campo "type" de la colección "inicio" está oculto con el valor "file"
      Y el campo "image" de la colección "creadoras" es de tipo "image"
      Y el campo "creator" de la colección "textos" es una relación con "creadoras"
      Y el campo "collectionCreator" de la colección "colecciones" es una relación con "creadoras"
      Y el campo "creator" de la colección "intervenciones" es una relación con "creadoras"
      Y el campo "keywords" de la colección "textos" es una relación con "palabras_clave"
      Y el campo "keywords" de la colección "colecciones" es una relación con "palabras_clave"
      Y la colección "textos" tiene los campos "title, subtitle, creator, body, date, keywords, license, language, slug, type"
      Y la colección "creadoras" tiene los campos "name, body, image, links, slug, type"
      Y la colección "colecciones" tiene los campos "title, subtitle, collectionCreatorPrefix, collectionCreator, body, date, keywords, license, language, files, slug, type"
      Y la colección "anuncios" tiene los campos "title, body, date, placement, language, slug, type"
      Y la colección "listas" tiene los campos "title, subtitle, body, filter, order, slug, type"
      Y la colección "intervenciones" tiene los campos "title, subtitle, creator, body, date, pages, lineLength, letterhead, letterheadHeight, license, language, slug, type"
      Y la colección "menu" tiene los campos "title, links, type"
      Y la colección "inicio" tiene los campos "title, subtitle, body, date, keywords, license, language, slug, type"
      Y el campo "body" de la colección "textos" tiene la etiqueta "Texto"
      Y el campo "body" de la colección "creadoras" tiene la etiqueta "Semblanza"
      Y el campo "collectionCreatorPrefix" de la colección "colecciones" tiene la etiqueta "Rol de la antologadora"
      Y el campo "collectionCreator" de la colección "colecciones" tiene la etiqueta "Antologadora"
      Y el campo "name" de la colección "creadoras" es obligatorio
      Y el campo "files" de la colección "colecciones" es obligatorio
      Y el campo "body" de la colección "textos" es obligatorio
      Y el campo "body" de la colección "creadoras" es obligatorio
      Y el campo "body" de la colección "anuncios" es obligatorio
      Y el campo "body" de la colección "listas" es obligatorio
      Y el campo "body" de la colección "colecciones" no es obligatorio
      Y el campo "body" de la colección "intervenciones" no es obligatorio
      Y el campo "title" de la colección "textos" no es obligatorio
      Y el campo "slug" de la colección "textos" no es obligatorio

    Escenario: Configura Netlify y las herramientas del build
      Dado que la raíz del proyecto se llama "segunda-iteracion"
      Cuando corro "init sveltia"
      Entonces el comando termina con el código de salida 0
      Y el archivo "netlify.toml" dice "[build]"
      Y el archivo "netlify.toml" dice "command = \"bun run build\""
      Y el archivo "netlify.toml" dice "publish = \"dist/files\""
      Y el archivo "netlify.toml" dice "BUN_VERSION"
      Y el archivo "netlify.toml" dice "netlify-plugin-cache"
      Y el archivo "netlify.toml" dice ".iteraciones"
      Y el archivo "Brewfile.netlify" dice "brew \"pandoc\""
      Y el archivo "Brewfile.netlify" dice "brew \"minify\""
      Y el archivo "Brewfile.netlify" no dice "imagemagick"
      Y el archivo "Brewfile.netlify" no dice "poppler"
      Y el archivo "Brewfile.netlify" no dice "texlive"
      Y la configuración de Sveltia usa el repositorio "OWNER/segunda-iteracion"
      Y la configuración de Sveltia usa el dominio "segunda-iteracion.netlify.app"
      Y el archivo "admin/config.yml" dice "site_url: https://segunda-iteracion.netlify.app"
      Y el archivo "admin/config.yml" dice "display_url: https://segunda-iteracion.netlify.app"
      Y el paquete declara la dependencia "netlify-plugin-cache" con el valor "1.0.3"

    Escenario: Agrega TeX al Brewfile cuando el proyecto genera PDF o LaTeX
      Dado que la raíz del proyecto está vacía
      Y que el archivo "iteraciones.config.yaml" tiene este contenido
        """
        language: es-MX
        format:
          html:
            generate: false
          latex:
            generate: true
        """
      Cuando corro "init sveltia"
      Entonces el comando termina con el código de salida 0
      Y el archivo "Brewfile.netlify" dice "brew \"texlive\""
      Y el archivo "Brewfile.netlify" dice "brew \"biber\""
      Y el archivo "Brewfile.netlify" dice "brew \"poppler\""
      Y el archivo "Brewfile.netlify" dice "brew \"imagemagick\""
      Y el archivo "Brewfile.netlify" no dice "minify"

    Escenario: Normaliza el nombre con acentos
      Dado que la raíz del proyecto se llama "Histórikas"
      Cuando corro "init sveltia"
      Entonces el comando termina con el código de salida 0
      Y la configuración de Sveltia usa el repositorio "OWNER/historikas"
      Y la configuración de Sveltia usa el dominio "historikas.netlify.app"

    Escenario: No genera Brewfile sin formatos activos
      Dado que la raíz del proyecto está vacía
      Y que el archivo "iteraciones.config.yaml" tiene este contenido
        """
        language: es-MX
        format:
          html:
            generate: false
          latex:
            generate: false
          pdf:
            generate: false
          epub:
            generate: false
          markdown:
            generate: false
        """
      Cuando corro "init sveltia"
      Entonces el comando termina con el código de salida 0
      Y el archivo "Brewfile.netlify" no existe
      Y el error dice "no hay formatos activos"

    Escenario: Detecta el repo y la rama
      Dado que la raíz del proyecto está vacía
      Y el proyecto tiene un remoto de GitHub "git@github.com:acme/sitio.git" en la rama "produccion"
      Cuando corro "init sveltia"
      Entonces el comando termina con el código de salida 0
      Y la configuración de Sveltia usa el repositorio "acme/sitio"
      Y la configuración de Sveltia usa la rama "produccion"
      Y el paquete no declara la dependencia "iteraciones-cli"

    Escenario: Sin remoto deja placeholders y avisa
      Dado que la raíz del proyecto está vacía
      Cuando corro "init sveltia"
      Entonces el comando termina con el código de salida 0
      Y el archivo "admin/config.yml" dice "OWNER/"
      Y el paquete no declara la dependencia "iteraciones-cli"
      Y el error dice "no encontré un remoto de GitHub"

    Escenario: Ejecutar dos veces no duplica ni cambia valores
      Dado que la raíz del proyecto está vacía
      Y el proyecto tiene un remoto de GitHub "git@github.com:acme/sitio.git"
      Cuando corro "init sveltia"
      Y corro "init sveltia"
      Entonces el comando termina con el código de salida 0
      Y la configuración de Sveltia usa el repositorio "acme/sitio"
      Y la configuración de Sveltia usa la rama "main"
      Y el archivo "admin/config.yml" menciona "acme/sitio" una sola vez
      Y el paquete no declara la dependencia "iteraciones-cli"
      Y el paquete declara la dependencia "netlify-plugin-cache" con el valor "1.0.3"

    Escenario: El paquete conserva lo existente y agrega lo mínimo
      Dado que la raíz del proyecto está vacía
      Y que el archivo "package.json" tiene este contenido
        """
        {"name":"mi-sitio","scripts":{"test":"echo ok"},"devDependencies":{"otra":"1.0.0","netlify-plugin-cache":"0.9.0"}}
        """
      Cuando corro "init sveltia"
      Entonces el comando termina con el código de salida 0
      Y el paquete conserva el script "test"
      Y el paquete conserva la dependencia "otra"
      Y el paquete declara el script "build"
      Y el paquete declara el script "dev"
      Y el paquete declara la dependencia "@sveltia/cms"
      Y el paquete declara la dependencia "netlify-plugin-cache" con el valor "0.9.0"
      Y el paquete no declara la dependencia "iteraciones-cli"

    Escenario: No sobrescribe el admin, Netlify ni el Brewfile existentes
      Dado que la raíz del proyecto está vacía
      Y que el archivo "admin/config.yml" tiene este contenido
        """
        backend:
          name: github
          repo: mio/proyecto
        """
      Y que el archivo "netlify.toml" tiene este contenido
        """
        [build]
          command = "otro"
        """
      Y que el archivo "Brewfile.netlify" tiene este contenido
        """
        brew "pandoc"
        """
      Cuando corro "init sveltia"
      Entonces el comando termina con el código de salida 0
      Y el archivo "admin/config.yml" dice "mio/proyecto"
      Y el archivo "admin/config.yml" no dice "OWNER/REPO"
      Y el archivo "netlify.toml" dice "otro"
      Y el archivo "netlify.toml" no dice "bun run build"
      Y el archivo "Brewfile.netlify" no dice "imagemagick"
      Y el paquete no declara la dependencia "netlify-plugin-cache"

    Escenario: El build publica el admin
      Dado que la raíz del proyecto está vacía
      Cuando corro "init sveltia"
      Y hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el sitio generado tiene el archivo "admin/index.html"
      Y el sitio generado tiene el archivo "admin/config.yml"
      Y el sitio generado tiene el archivo "admin/vendor/sveltia-cms.js"
