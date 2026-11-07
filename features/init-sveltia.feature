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
      Y el paquete no declara la dependencia "iteraciones-cli"
      Y el paquete no declara la dependencia "@sveltia/cms"

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
