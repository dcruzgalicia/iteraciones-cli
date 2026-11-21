Característica: create arma el proyecto mínimo y las integraciones opcionales

  Como quien viene de Quarto
  Quiero crear un proyecto con create y activar lo avanzado con opciones
  Para no adivinar la configuración inicial

  Regla de negocio: Sin preguntas, create deja un proyecto HTML mínimo

    Escenario: create --no-prompt crea la configuración y el index
      Dado que la raíz del proyecto está vacía
      Cuando parseo el comando "create --no-prompt" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "iteraciones.config.yaml" existe
      Y el archivo "index.md" existe
      Y el archivo "bibliography.bib" no existe
      Y el directorio "admin" no existe
      Y el directorio ".git" no existe
      Y la configuración activa los formatos "html"
      Y el archivo "iteraciones.config.yaml" dice "license: CC-BY-NC-ND-4.0"

    Escenario: El proyecto mínimo compila
      Dado que la raíz del proyecto está vacía
      Cuando parseo el comando "create --no-prompt" sobre la raíz del proyecto
      Y compilo el proyecto recién creado
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/index.html" existe

    Escenario: El proyecto mínimo pasa validate
      Dado que la raíz del proyecto está vacía
      Cuando parseo el comando "create --no-prompt" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 0
      Y el proyecto recién creado pasa validate
      Y la salida de error no lleva ningún error

  Regla de negocio: Los formatos y la bibliografía se eligen con opciones

    Escenario: create activa PDF además de HTML
      Dado que la raíz del proyecto está vacía
      Cuando parseo el comando "create --no-prompt --format html,pdf" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 0
      Y la configuración activa los formatos "html, pdf"

    Escenario: create declara la bibliografía y crea el archivo vacío
      Dado que la raíz del proyecto está vacía
      Cuando parseo el comando "create --no-prompt --format html,pdf --bibliography refs/libro.bib" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "iteraciones.config.yaml" dice "bibliography: refs/libro.bib"
      Y el archivo "refs/libro.bib" existe

    Escenario: create usa la licencia indicada
      Dado que la raíz del proyecto está vacía
      Cuando parseo el comando "create --no-prompt --license PF-AC-PR-FA-1.0" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "iteraciones.config.yaml" dice "license: PF-AC-PR-FA-1.0"

    Escenario: create acepta un formato desconocido como error
      Dado que la raíz del proyecto está vacía
      Cuando parseo el comando "create --no-prompt --format docx" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 1
      Y el error dice "formato desconocido"

  Regla de negocio: Las plantillas actuales siguen disponibles

    Escenario: create --template blog usa la plantilla
      Dado que la raíz del proyecto está vacía
      Cuando parseo el comando "create --template blog --no-prompt" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "iteraciones.config.yaml" dice "title: Mi blog"
      Y el archivo "index.md" existe
      Y el directorio "admin" no existe

    Escenario: create --template no se mezcla con las opciones del proyecto mínimo
      Dado que la raíz del proyecto está vacía
      Cuando parseo el comando "create --template blog --format pdf" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 1
      Y el error dice "--template no se combina"

  Regla de negocio: Sveltia se elige desde create

    Escenario: create --sveltia usa el flujo simple
      Dado que la raíz del proyecto está vacía
      Cuando parseo el comando "create --no-prompt --sveltia" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "admin/config.yml" existe
      Y el archivo "admin/config.yml" no dice "publish_mode"
      Y el archivo "admin/config.yml" no dice "open_authoring"

    Escenario: create --sveltia --editorial-workflow activa el flujo editorial
      Dado que la raíz del proyecto está vacía
      Cuando parseo el comando "create --no-prompt --sveltia --editorial-workflow" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "admin/config.yml" dice "publish_mode: editorial_workflow"
      Y el archivo "admin/config.yml" no dice "open_authoring"

    Escenario: create --sveltia --open-authoring activa open authoring
      Dado que la raíz del proyecto está vacía
      Cuando parseo el comando "create --no-prompt --sveltia --open-authoring" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "admin/config.yml" dice "publish_mode: editorial_workflow"
      Y el archivo "admin/config.yml" dice "open_authoring: true"

  Regla de negocio: Git se inicializa sólo si se pide

    Escenario: create --git inicializa el repositorio
      Dado que la raíz del proyecto está vacía
      Cuando parseo el comando "create --no-prompt --git" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 0
      Y el directorio ".git" existe

  Regla de negocio: add agrega Sveltia a un proyecto existente

    Escenario: add sveltia --no-prompt usa el flujo simple
      Dado que la raíz del proyecto está vacía
      Cuando parseo el comando "add sveltia --no-prompt" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "admin/config.yml" existe
      Y el archivo "admin/config.yml" no dice "publish_mode"
      Y el archivo "admin/config.yml" no dice "open_authoring"

    Escenario: add sveltia --workflow editorial activa el flujo editorial
      Dado que la raíz del proyecto está vacía
      Cuando parseo el comando "add sveltia --no-prompt --workflow editorial" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "admin/config.yml" dice "publish_mode: editorial_workflow"
      Y el archivo "admin/config.yml" no dice "open_authoring"

    Escenario: add sveltia --workflow open-authoring activa open authoring
      Dado que la raíz del proyecto está vacía
      Cuando parseo el comando "add sveltia --no-prompt --workflow open-authoring" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "admin/config.yml" dice "publish_mode: editorial_workflow"
      Y el archivo "admin/config.yml" dice "open_authoring: true"

    Escenario: add rechaza una extensión desconocida
      Dado que la raíz del proyecto está vacía
      Cuando parseo el comando "add otra --no-prompt" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 1
      Y el error dice "extensión desconocida"

  Regla de negocio: Los alias de Quarto siguen el mismo camino

    Escenario: render es alias de build
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Cuando parseo el comando "render" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/test-document.html" existe

    Escenario: check es alias de doctor
      Dado que la raíz del proyecto está vacía
      Cuando parseo el comando "check --json" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 0
      Y el JSON declara la clave "ok" con el valor verdadero
