# language: es
Característica: init sveltia deja un proyecto listo para el admin

  Como quien publica un sitio con Sveltia
  Quiero que la CLI cree el admin y el layout de contenido
  Para no configurar Sveltia a mano

  Regla de negocio: init sveltia crea el admin y el layout sin sobrescribir

    Escenario: Crea el admin, las carpetas y el package.json
      Dado que la raíz del proyecto está vacía
      Cuando corro "init sveltia"
      Entonces el comando termina con el código de salida 0
      Y el archivo "iteraciones.config.yaml" existe
      Y el archivo "index.md" existe
      Y el archivo "menu.md" existe
      Y el archivo "admin/index.html" existe
      Y el archivo "admin/config.yml" existe
      Y el archivo "admin/vendor/sveltia-cms.js" existe
      Y el archivo "textos/ejemplo.md" existe
      Y el archivo "creadoras/ejemplo.md" existe
      Y el archivo "colecciones/ejemplo.md" existe
      Y el archivo "listas/ejemplo.md" existe
      Y el archivo "anuncios/ejemplo.md" existe
      Y el archivo "intervenciones/ejemplo.md" existe
      Y el archivo "palabras-clave/.gitkeep" existe

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
      Y la configuración de Sveltia declara el campo "collectionCreator" en la colección "colecciones"
      Y la configuración de Sveltia declara el campo "placement" en la colección "anuncios"
      Y la configuración de Sveltia ofrece la licencia "CC-BY-NC-ND-4.0"
      Y la configuración de Sveltia ofrece la licencia "PF-AC-PR-FA-1.0"

    Escenario: La configuración sigue el layout de Histórikas
      Dado que la raíz del proyecto está vacía
      Cuando corro "init sveltia"
      Entonces el comando termina con el código de salida 0
      Y la configuración de Sveltia declara el archivo "index.md"
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

    Escenario: El paquete conserva lo existente y agrega lo mínimo
      Dado que la raíz del proyecto está vacía
      Y que el archivo "package.json" tiene este contenido
        """
        {"name":"mi-sitio","scripts":{"test":"echo ok"},"devDependencies":{"otra":"1.0.0"}}
        """
      Cuando corro "init sveltia"
      Entonces el comando termina con el código de salida 0
      Y el paquete conserva el script "test"
      Y el paquete conserva la dependencia "otra"
      Y el paquete declara el script "build"
      Y el paquete declara el script "dev"
      Y el paquete declara la dependencia "@sveltia/cms"
      Y el paquete no declara la dependencia "iteraciones-cli"

    Escenario: No sobrescribe el admin existente
      Dado que la raíz del proyecto está vacía
      Y que el archivo "admin/config.yml" tiene este contenido
        """
        backend:
          name: github
          repo: mio/proyecto
        """
      Cuando corro "init sveltia"
      Entonces el comando termina con el código de salida 0
      Y el archivo "admin/config.yml" dice "mio/proyecto"
      Y el archivo "admin/config.yml" no dice "OWNER/REPO"

    Escenario: El build publica el admin
      Dado que la raíz del proyecto está vacía
      Cuando corro "init sveltia"
      Y hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el sitio generado tiene el archivo "admin/index.html"
      Y el sitio generado tiene el archivo "admin/config.yml"
      Y el sitio generado tiene el archivo "admin/vendor/sveltia-cms.js"
