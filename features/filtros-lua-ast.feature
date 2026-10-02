# language: es
@requires-pandoc
Característica: El filtro semántico convierte los separadores en bloques con significado
  Como quien escribe un documento con separadores `::`
  Quiero que el build los convierta en un bloque con nombre
  Para que la composición sepa dónde va el espacio vertical

  # Estos escenarios comparan el AST COMPLETO de pandoc, no su salida. Es el
  # único punto de la suite donde se inspecciona la estructura, y por eso
  # merecen steps con nombre en vez de una tabla de `toContain`.

  Regla de negocio: Los separadores sueltos producen Div.spacer
    El esperado completo vive en `features/fixtures/lua-filters-ast/<caso>.json`.

    Esquema del escenario: El AST del documento convertido
      Dado el caso de AST "<caso>"
      Cuando lo convierto a JSON con los filtros semánticos
      Entonces el AST es el esperado

      Ejemplos:
        | caso |
        | convierte-sola-en-una-linea-a-div-spacer |
        | no-modifica-con-texto-en-la-misma-linea |
        | no-modifica-texto-sin-ni |
        | no-modifica-dentro-de-un-bloque-de-codigo |

    Escenario: El `:` seguido de punto y coma lleva la clase noindent
      Dado un cuerpo con dos puntos seguidos de punto y coma
      Cuando lo convierto a JSON con los filtros semánticos
      Entonces el único Div es un spacer con la clase noindent

    Escenario: Varios separadores en el mismo documento producen varios spacers
      Dado un cuerpo con dos separadores
      Cuando lo convierto a JSON con los filtros semánticos
      Entonces hay dos Divs de tipo spacer

    Escenario: Un separador dentro de un item de lista también se convierte
      Dado un cuerpo con un separador como primer item de una lista
      Cuando lo convierto a JSON con los filtros semánticos
      Entonces la lista tiene un primer item que es un Div spacer

    Escenario: El espacio final no cambia el resultado (#pandoc normaliza el AST)
      Dado un cuerpo con un separador y un espacio al final
      Cuando lo convierto a JSON con los filtros semánticos
      Entonces el único Div es un spacer sin clases extra