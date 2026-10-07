# language: es
Característica: cómo se le enseña un error al autor

  Como a quien le falla el build
  Quiero un mensaje que diga qué pasó
  Para no tener que leer el nombre de la clase del error

  # Tramo 47 de la migración. 9 de los 9 casos de `errors.test.ts`. El archivo
  # queda cerrado.

  # Se quita el prefijo de la clase, no la palabra. `BuildError: build falló` se
  # muestra como `build falló`: el autor ya sabe que es un error, repetirlo le
  # quita espacio para lo que importa.

  Regla de negocio: El prefijo de la clase no se le enseña al autor

    # `BuildError: build falló` sale como `build falló`: el autor ya sabe que es
    # un error, repetirlo le quita espacio para lo que importa.

    Escenario: Un SyntaxError sale sin su nombre de clase
      Dado que la raíz del proyecto está vacía
      Y un error de la clase:
        """
        SyntaxError ;; yaml: línea inválida
        """
      Cuando lo formateo para el autor
      Entonces el autor lee:
        """
        yaml: línea inválida
        """

    Escenario: Un TypeError sale sin su nombre de clase
      Dado que la raíz del proyecto está vacía
      Y un error de la clase:
        """
        TypeError ;; valor no inesperado
        """
      Cuando lo formateo para el autor
      Entonces el autor lee:
        """
        valor no inesperado
        """

    Escenario: Un BuildError sale sin su nombre de clase
      Dado que la raíz del proyecto está vacía
      Y un error de la clase:
        """
        Error ;; BuildError: build falló
        """
      Cuando lo formateo para el autor
      # La clase del proyecto también: `BuildError` y `ConfigError` no le
      # dicen nada al autor.
      Entonces el autor lee:
        """
        build falló
        """

    Escenario: Un ConfigError sale sin su nombre de clase
      Dado que la raíz del proyecto está vacía
      Y un error de la clase:
        """
        Error ;; ConfigError: config inválida
        """
      Cuando lo formateo para el autor
      Entonces el autor lee:
        """
        config inválida
        """

    # `Error` EN MEDIO del mensaje se conserva: habla del YAML que se está
    # parseando, y quitar ahí la palabra rompería la frase.
    Escenario: La palabra Error en medio del mensaje no se quita
      Dado que la raíz del proyecto está vacía
      Y un error de la clase:
        """
        Error ;; Error en línea 5 - token inesperado
        """
      Cuando lo formateo para el autor
      # No es un prefijo: es parte de la frase.
      Entonces el autor lee:
        """
        Error en línea 5 - token inesperado
        """

    Escenario: Un mensaje que ya está limpio sale igual
      Dado que la raíz del proyecto está vacía
      Y un error de la clase:
        """
        Error ;; documento sin frontmatter válido
        """
      Cuando lo formateo para el autor
      # Sin prefijo que quitar: el mensaje sale byte a byte.
      Entonces el autor lee:
        """
        documento sin frontmatter válido
        """

    # Un valor que no es un error —un string tireado por un `catch`— también
    # tiene que llegar al autor legible, y `String()` es el contrato: nunca
    # "[object Object]".
    Escenario: Un texto que no es un error se lee como texto
      Dado que la raíz del proyecto está vacía
      Y un valor que no es un error:
        """
        texto plano
        """
      Cuando lo formateo para el autor
      Entonces el autor lee:
        """
        texto plano
        """

    Escenario: Un número que no es un error se lee como número
      Dado que la raíz del proyecto está vacía
      Y un valor que no es un error:
        """
        42
        """
      Cuando lo formateo para el autor
      Entonces el autor lee:
        """
        42
        """

  Regla de negocio: Los códigos del sistema se traducen

    # `EACCES` no le dice nada a nadie; "sin permisos de lectura" sí.

    # `EACCES` no le dice nada a nadie; "sin permisos de lectura" sí.

    Escenario: EACCES dice que faltan permisos
      Dado que la raíz del proyecto está vacía
      Y un error del sistema con el código:
        """
        EACCES
        """
      Cuando traduzco el error del sistema
      Entonces el autor lee:
        """
        sin permisos de lectura
        """

    Escenario: EISDIR dice que es un directorio
      Dado que la raíz del proyecto está vacía
      Y un error del sistema con el código:
        """
        EISDIR
        """
      Cuando traduzco el error del sistema
      # El caso inverso al anterior: sí es un directorio.
      Entonces el autor lee:
        """
        es un directorio, no un archivo
        """

    Escenario: ENOTDIR dice que la ruta intermedia no lo es
      Dado que la raíz del proyecto está vacía
      Y un error del sistema con el código:
        """
        ENOTDIR
        """
      Cuando traduzco el error del sistema
      # Un `ENOTDIR` en medio del camino, no en el final.
      Entonces el autor lee:
        """
        una ruta intermedia no es un directorio
        """

    # Un código que no está en la tabla se devuelve tal cual: inventar una
    # traducción para algo que no se conoce sería mentir sobre la causa.
    Escenario: Un código desconocido se devuelve tal cual
      Dado que la raíz del proyecto está vacía
      Y un error del sistema con el código:
        """
        EUNKNOWN
        """
      Cuando traduzco el error del sistema
      # Sin traducción inventada: el código es la información.
      Entonces el autor lee:
        """
        EUNKNOWN
        """

    Escenario: Un error sin código conserva su mensaje
      Dado que la raíz del proyecto está vacía
      Y un error de la clase:
        """
        Error ;; algo falló
        """
      Cuando traduzco el error del sistema
      # Sin `code` no hay nada que traducir.
      Entonces el autor lee:
        """
        algo falló
        """

  # El mismo ENOENT significa dos cosas según de dónde venga, y el `hint` lo
  # dice. Por eso hay dos expectativas para el mismo código.

  Regla de negocio: El hint distingue los dos ENOENT

    Escenario: Un documento que falta sugiere verificar el nombre
      Dado que la raíz del proyecto está vacía
      Y un error del sistema con el código:
        """
        ENOENT
        """
      Y la pista:
        """
        verifica que el nombre del archivo sea correcto
        """
      Cuando traduzco el error del sistema
      # Casi siempre es un nombre mal escrito, y eso tiene arreglo.
      Entonces el autor lee:
        """
        archivo no encontrado: verifica que el nombre del archivo sea correcto
        """

    Escenario: Sin pista el ENOENT conserva su texto de sistema
      Dado que la raíz del proyecto está vacía
      Y un error del sistema con el código:
        """
        ENOENT
        """
      Cuando traduzco el error del sistema
      # Rutas internas —logo, recursos—: la causa no es el nombre.
      Entonces el autor lee:
        """
        archivo no encontrado (posiblemente eliminado durante el build)
        """

    Escenario: Lo que no es un error se traduce como texto
      Dado que la raíz del proyecto está vacía
      Y un valor que no es un error:
        """
        texto plano
        """
      Cuando traduzco el error del sistema
      # Mismo contrato que al formatear: nunca "[object Object]".
      Entonces el autor lee:
        """
        texto plano
        """