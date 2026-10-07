# language: es
Característica: un directorio ignorado se salta entero

  Como quien tiene `dist/` y `node_modules/` en el proyecto
  Quiero que el build no los recorra
  Para no perder el tiempo de build leyendo archivos que no se compilan

  Regla de negocio: Un directorio ignorado se salta entero, sin mirar dentro

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

    Esquema del escenario: Una carpeta normal no está dentro de un directorio ignorado
      Dado que la raíz del proyecto está vacía
      Entonces la ruta "<ruta>" no está dentro de un directorio ignorado

      Ejemplos:
        | ruta |
        | normal.md |
        | docs/normal.md |
        | node-modules-falso/x.md |