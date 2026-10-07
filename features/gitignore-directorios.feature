# language: es
Característica: un directorio ignorado se salta entero

  Como quien tiene `dist/` y `node_modules/` en el proyecto
  Quiero que el build no los recorra
  Para no perder el tiempo de build leyendo archivos que no se compilan

  # Tramo 27 de la migración. `isInsideIgnoredDir` de `gitignore.test.ts`.
  # Feature aparte: su paso dice "la ruta" y con las tablas de reglas en el
  # mismo feature `check-steps` mezcla las columnas.

  Regla de negocio: Un directorio ignorado se salta entero, sin mirar dentro

    # Es la optimización que hace el descubrimiento rápido: si `dist/` está
    # ignorado, no hay que recorrer sus cientos de archivos para decidir que
    # ninguno vale. Y el prefijo `.` es la misma idea.

    Esquema del escenario: Un directorio ignorado o con punto no se recorre
      Dado que la raíz del proyecto está vacía
      Entonces la ruta "<ruta>" está dentro de un directorio ignorado

      Ejemplos:
        | ruta |
        | node_modules/paquete/leeme.md |
        | dist/files/x.html |
        | .iteraciones/ast/x.json |
        | docs/node_modules/x.md |
        | a/b/c/dist/x.md |

    # Y una carpeta que sólo empieza por el nombre del directorio ignorado no es
    # el directorio ignorado.
    Esquema del escenario: Una carpeta normal no está dentro de un directorio ignorado
      Dado que la raíz del proyecto está vacía
      Entonces la ruta "<ruta>" no está dentro de un directorio ignorado

      Ejemplos:
        | ruta |
        | normal.md |
        | docs/normal.md |
        | node-modules-falso/x.md |