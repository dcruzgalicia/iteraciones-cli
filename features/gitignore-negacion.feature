# language: es
Característica: la negación en `.gitignore`

  Como que tengo notas en markdown dentro del proyecto
  Quiero decir "todo markdown, menos estas"
  Para que las notas no se compilen sin renunciar al resto

  # Tramo 27 de la migración. `gitignore.test.ts`.
  # Feature aparte porque `check-steps` mezcla las filas de todas las tablas
  # `Ejemplos` de un mismo feature y los placeholders dejan de casar.

  Regla de negocio: La última regla gana, y una negación re-incluye

    # La negación es lo que permite decir "todo markdown, menos las notas". Sin
    # ella no habría forma de excluir un subconjunto dentro de un directorio
    # entero.

    Esquema del escenario: Una negación después de un patrón
      Dado que la raíz del proyecto está vacía
      Y que el .gitignore dice:
      """
      <reglas>
      """
      Entonces el archivo "<ruta>" <resultado> por las reglas

      Ejemplos:
        | reglas | ruta | resultado |
        | *.md | normal.md | "queda ignorado" |
        | *.md<br>!importante.md | importante.md | "no queda ignorado" |
        | nota.md | sub/nota.md | "queda ignorado" |

    # Sin reglas no se ignora nada: un proyecto sin `.gitignore` compila todo lo
    # que hay.
    Escenario: Sin reglas no se ignora nada
      Dado que la raíz del proyecto está vacía
      Y que el .gitignore dice:
      """
      """
      Entonces el archivo "cualquiera.md" no queda ignorado por las reglas
