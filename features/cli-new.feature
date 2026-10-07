# language: es
Característica: new crea el documento e infiere el título

  Como quien arranca un artículo a las tres de la mañana
  Quiero que `iteraciones new` infiera el título a partir del nombre de archivo
  Para no escribir el frontmatter a mano

  Regla de negocio: El título se infiere del nombre del archivo

    Esquema del escenario: "<argumento>" produce el título "<título>"
      Dado que la raíz del proyecto está vacía
      Cuando creo el documento "<argumento>"
      Entonces el comando termina con el código de salida 0
      Y el archivo "<archivo>" existe
      Y el frontmatter de "<archivo>" declara el título "<título>"

      Ejemplos:
        | argumento                   | archivo                     | título             |
        | corazón-profundo            | corazón-profundo.md         | Corazón Profundo   |
        | posts/mi-articulo           | posts/mi-articulo.md        | Mi Articulo        |
        | posts/una-larga-historia.md | posts/una-larga-historia.md | Una Larga Historia |
        | hola                        | hola.md                     | Hola               |
        | con-ejemplos                | con-ejemplos.md             | Con Ejemplos       |
        | ensayo                     | ensayo.md                  | Ensayo             |
        | mi articulo nuevo           | mi-articulo-nuevo.md        | Mi Articulo Nuevo  |
        | d'artagnan                  | d'artagnan.md               | D'artagnan         |
        | mi-artículo                 | mi-artículo.md              | Mi Artículo        |
        | año-nuevo                   | año-nuevo.md                | Año Nuevo           |

  Regla de negocio: El frontmatter mínimo trae fecha

    Escenario: El documento nuevo trae la clave date
      Dado que la raíz del proyecto está vacía
      Cuando creo el documento "posts/mi-articulo"
      Entonces el archivo "posts/mi-articulo.md" tiene la clave "date:"

  Regla de negocio: Los ejemplos del lenguaje van en el cuerpo

    Escenario: El documento nuevo trae ejemplos que el usuario borra
      Dado que la raíz del proyecto está vacía
      Cuando creo el documento "con-ejemplos"
      Entonces el archivo "con-ejemplos.md" contiene "::"
      Y el archivo "con-ejemplos.md" contiene "::: {.dictum}"
      Y el frontmatter de "con-ejemplos.md" no menciona "dictum"

  Regla de negocio: Un título explícito gana sobre la inferencia

    Esquema del escenario: El título "<rareza>" se escribe como YAML válido
      Dado que la raíz del proyecto está vacía
      Cuando creo el documento "mi-articulo" con el título "<título>"
      Entonces el frontmatter de "mi-articulo.md" declara el título "<título>"

      Ejemplos:
        | rareza                   | título                            |
        | apóstrofo                | D'Artagnan                        |
        | signos de interrogación  | ¿Qué falta?                       |
        | dos puntos y apóstrofo   | Los tres mosqueteros: d'Artagnan  |

    Escenario: El título El "jardín" de las delicias se escribe como YAML válido
      Dado que la raíz del proyecto está vacía
      Cuando creo el documento "mi-articulo" con un título con comillas
      Entonces el frontmatter de "mi-articulo.md" declara ese título con comillas

  Regla de negocio: Un nombre con acentos no dispara un aviso falso

    Escenario: Un nombre con acentos no dispara un aviso
      Dado que la raíz del proyecto está vacía
      Cuando creo el documento "mi-artículo"
      Entonces el comando termina con el código de salida 0
      Y la salida de error no lleva ningún aviso
      Y el frontmatter de "mi-artículo.md" declara el título "Mi Artículo"

  Regla de negocio: Crear dos veces el mismo documento no falla

    Escenario: El documento ya existente no es un error
      Dado que la raíz del proyecto está vacía
      Cuando creo el documento "doc"
      Y creo el documento "doc"
      Entonces el comando termina con el código de salida 0

  Regla de negocio: Las rutas que no son un nombre de archivo se rechazan

    Esquema del escenario: "<argumento>" se rechaza por "<motivo>"
      Dado que la raíz del proyecto está vacía
      Cuando creo el documento "<argumento>"
      Entonces el comando termina con el código de salida 1
      Y el error dice "<motivo>"

      Ejemplos:
        | argumento  | motivo                                                            |
        | /etc/passwd | la ruta debe ser relativa al directorio del proyecto               |
        | .          | la ruta debe ser relativa al directorio del proyecto               |
        | posts/     | la ruta debe incluir un nombre de archivo                          |
        | .oculto.md | la ruta debe incluir un nombre de archivo                          |

    Escenario: El rechazo por nombre faltante dice con qué se ve bien
      Dado que la raíz del proyecto está vacía
      Cuando creo el documento "posts/"
      Entonces el error dice "posts/mi-articulo.md"
      Y el archivo "posts/.md" no existe

    Esquema del escenario: Un nombre rechazado no deja ningún archivo
      Dado que la raíz del proyecto está vacía
      Cuando creo el documento "<argumento>"
      Entonces el archivo "<archivo>" no existe

      Ejemplos:
        | argumento  | archivo      |
        | .oculto.md | .oculto.md   |
        | posts/     | posts/.md    |
        | .          | .md          |

  Regla de negocio: El documento sobrevive a validate y a build

    @requires-pandoc
    Escenario: Un título difícil sobrevive a validate y a build
      Dado que la raíz del proyecto tiene una configuración mínima
      Cuando creo el documento "articulo" con el título "Los tres mosqueteros: d'Artagnan"
      Y valido el proyecto que acabo de crear
      Y construyo el proyecto
      Entonces el comando termina con el código de salida 0