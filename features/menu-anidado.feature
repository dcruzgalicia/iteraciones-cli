Característica: menú anidado

  Para que una colectiva o universidad agrupe secciones
  Quiero enlaces con hijos en cualquier profundidad

  Escenario: validate reporta un enlace sin url
    Dado que la raíz del proyecto está vacía
    Y que el archivo "menu.md" tiene este contenido
      """
      ---
      title: Menú
      type: menu
      links:
        - name: Inicio
          children:
            - name: Textos
              url: texto.html
      ---
      """
    Cuando corro "validate"
    Entonces el comando termina con el código de salida 1
    Y el error dice "links[0].url"

  Escenario: menu.html muestra hijos y nietos
    Dado que la raíz del proyecto tiene un proyecto de prueba
    Y que el archivo "menu.md" tiene este contenido
      """
      ---
      title: Menú
      type: menu
      links:
        - name: Inicio
          url: index.html
          children:
            - name: Textos
              url: texto.html
              children:
                - name: Ensayos
                  url: texto.html
      ---
      """
    Cuando hago un build del proyecto
    Entonces el comando termina con el código de salida 0
    Y el archivo "dist/files/menu.html" contiene "Ensayos"
    Y el HTML del menú tiene al menos 2 listas
