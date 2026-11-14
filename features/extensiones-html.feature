Característica: extensiones opcionales del sitio HTML

  Escenario: La búsqueda genera página e índice
    Dado que la raíz del proyecto tiene un proyecto de prueba
    Y el proyecto produce html
    Y que el archivo "iteraciones.config.yaml" tiene este contenido
      """
      language: es-MX
      format:
        html:
          generate: true
          site:
            title: Buscador
            search: true
      """
    Y que el archivo "texto.md" tiene este contenido
      """
      ---
      title: Texto buscable
      keywords: [memoria]
      ---

      Contenido sobre memoria.
      """
    Cuando hago un build del proyecto
    Entonces el comando termina con el código de salida 0
    Y el archivo "dist/files/buscar.html" existe
    Y el archivo "dist/files/buscar.json" existe
    Y el archivo "dist/files/buscar.html" contiene "Buscar"
    Y el archivo "dist/files/buscar.json" contiene "Texto buscable"

  Escenario: El hero solo aparece en la portada
    Dado que la raíz del proyecto tiene un proyecto de prueba
    Y el proyecto produce html
    Y que el archivo "iteraciones.config.yaml" tiene este contenido
      """
      language: es-MX
      format:
        html:
          generate: true
          site:
            title: Hero
            home:
              title: Bienvenida
              text: Texto de portada.
              label: Entrar
              url: ./index.html
      """
    Y que el archivo "index.md" tiene este contenido
      """
      ---
      title: Inicio
      ---

      Contenido.
      """
    Y que el archivo "otro.md" tiene este contenido
      """
      ---
      title: Otro
      ---

      Otro contenido.
      """
    Cuando hago un build del proyecto
    Entonces el comando termina con el código de salida 0
    Y el archivo "dist/files/index.html" contiene "Bienvenida"
    Y el archivo "dist/files/otro.html" no contiene "Bienvenida"

  Escenario: Las etiquetas de interfaz se pueden sobrescribir
    Dado que la raíz del proyecto tiene un proyecto de prueba
    Y el proyecto produce html
    Y que el archivo "iteraciones.config.yaml" tiene este contenido
      """
      language: es-MX
      format:
        html:
          generate: true
          site:
            title: Etiquetas
            labels:
              menu: Navegar
      """
    Y que el archivo "menu.md" tiene este contenido
      """
      ---
      type: menu
      title: Menú
      links:
        - name: Inicio
          url: ./index.html
      ---
      """
    Cuando hago un build del proyecto
    Entonces el comando termina con el código de salida 0
    Y el archivo "dist/files/index.html" contiene ">Navegar</span>"

  Escenario: OAI-PMH genera un ListRecords Dublin Core
    Dado que la raíz del proyecto tiene un proyecto de prueba
    Y el proyecto produce html
    Y que el archivo "iteraciones.config.yaml" tiene este contenido
      """
      language: es-MX
      format:
        html:
          generate: true
          site:
            title: Repositorio
            url: https://repo.example
            oai: true
      """
    Y que el archivo "documento.md" tiene este contenido
      """
      ---
      title: Documento
      creator: Ana Ruiz
      date: 2026-01-01
      identifier: REP-001
      ---

      Contenido.
      """
    Cuando hago un build del proyecto
    Entonces el comando termina con el código de salida 0
    Y el archivo "dist/files/oai.xml" existe
    Y el archivo "dist/files/oai.xml" contiene "<OAI-PMH"
    Y el archivo "dist/files/oai.xml" contiene "REP-001"
    Y el archivo "dist/files/oai.xml" contiene "<dc:creator>Ana Ruiz</dc:creator>"
    Y el archivo "dist/files/oai.xml" contiene "<dc:type>Text</dc:type>"

  Escenario: Las listas en listas/ enlazan a su salida en la raíz
    Dado que la raíz del proyecto tiene un proyecto de prueba
    Y el proyecto produce html
    Y que el archivo "textos/uno.md" tiene este contenido
      """
      ---
      title: Uno
      ---

      Primer texto.
      """
    Y que el archivo "textos/dos.md" tiene este contenido
      """
      ---
      title: Dos
      ---

      Segundo texto.
      """
    Y que el archivo "listas/todos.md" tiene este contenido
      """
      ---
      title: Todos
      type: list
      filter:
        path: textos/
      ---

      Todos los textos.
      """
    Y que el archivo "listas/otros.md" tiene este contenido
      """
      ---
      title: Otros
      type: list
      filter:
        path: textos/
      ---

      Otra lista.
      """
    Cuando hago un build del proyecto
    Entonces el comando termina con el código de salida 0
    Y el archivo "dist/files/todos.html" existe
    Y el archivo "dist/files/lista.html" contiene "\"./todos.html\""

  Escenario: Las etiquetas de tipo y llamada a la acción se pueden sobrescribir
    Dado que la raíz del proyecto tiene un proyecto de prueba
    Y el proyecto produce html
    Y que el archivo "iteraciones.config.yaml" tiene este contenido
      """
      language: es-MX
      format:
        html:
          generate: true
          site:
            title: Etiquetas
            labels:
              recientes: Novedades
              palabras-clave: Temas
              texto: Publicación
              colaboradora: Autora
              leer-texto-completo: Abrir
      """
    Y que el archivo "textos/uno.md" tiene este contenido
      """
      ---
      title: Uno
      keywords: [memoria]
      ---

      Primer texto.
      """
    Y que el archivo "textos/dos.md" tiene este contenido
      """
      ---
      title: Dos
      keywords: [memoria]
      ---

      Segundo texto.
      """
    Cuando hago un build del proyecto
    Entonces el comando termina con el código de salida 0
    Y el archivo "dist/files/textos/uno.html" contiene "Novedades"
    Y el archivo "dist/files/textos/uno.html" contiene "Temas"
    Y el archivo "dist/files/texto.html" contiene ">Publicación</h2>"
    Y el archivo "dist/files/texto.html" contiene "Abrir →"
