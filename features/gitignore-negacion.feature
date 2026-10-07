# language: es
Característica: la negación en `.gitignore`

  Como que tengo notas en markdown dentro del proyecto
  Quiero decir "todo markdown, menos estas"
  Para que las notas no se compilen sin renunciar al resto

  Regla de negocio: La última regla gana, y una negación re-incluye

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

    Escenario: Sin reglas no se ignora nada
      Dado que la raíz del proyecto está vacía
      Y que el .gitignore dice:
      """
      """
      Entonces el archivo "cualquiera.md" no queda ignorado por las reglas
