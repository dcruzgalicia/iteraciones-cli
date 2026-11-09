# language: es
Característica: init agrega node_modules al .gitignore

  Como quien va a instalar dependencias del proyecto
  Quiero que node_modules quede ignorado
  Para no commitearlo por accidente

  Regla de negocio: node_modules/ se agrega sin tocar el resto

    Escenario: En una carpeta vacía
      Dado que la raíz del proyecto está vacía
      Cuando corro "init"
      Entonces el comando termina con el código de salida 0
      Y el archivo ".gitignore" dice "node_modules/"

    Escenario: En un .gitignore existente sin la regla
      Dado que la raíz del proyecto está vacía
      Y que el archivo ".gitignore" tiene este contenido
        """
        dist/
        mi-regla/
        """
      Cuando corro "init"
      Entonces el comando termina con el código de salida 0
      Y el archivo ".gitignore" dice "dist/"
      Y el archivo ".gitignore" dice "mi-regla/"
      Y el archivo ".gitignore" dice "node_modules/"

    Escenario: No duplica la regla
      Dado que la raíz del proyecto está vacía
      Y que el archivo ".gitignore" tiene este contenido
        """
        node_modules/
        dist/
        """
      Cuando corro "init"
      Entonces el comando termina con el código de salida 0
      Y el archivo ".gitignore" menciona "node_modules/" una sola vez
      Y el archivo ".gitignore" dice "dist/"

    Escenario: init sveltia aplica la misma regla
      Dado que la raíz del proyecto está vacía
      Cuando corro "init sveltia"
      Entonces el comando termina con el código de salida 0
      Y el archivo ".gitignore" dice "node_modules/"
