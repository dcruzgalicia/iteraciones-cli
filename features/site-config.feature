# language: es
Característica: qué formatos se generan

  Como quien escribe un libro que sólo necesita PDF
  Quiero que la configuración diga una sola cosa por formato
  Para no pedir un PDF sin haber pedido el LaTeX que lo produce

  # Tramo 50 de la migración. 7 de los 7 casos de `site-config.test.ts`. El
  # archivo queda cerrado.

  # `generate` es la única palanca, y `merge` no cuenta. El PDF se genera a
  # partir del LaTeX, así que `latex.generate: false` apaga el PDF aunque diga
  # `pdf.generate: true`.

  Regla de negocio: Cada formato que se pide, se genera

    # Sin nada pedido no hay nada que generar: la lista vacía es lo que hace que
    # un build no escriba archivos que nadie pidió.

    Escenario: Sin formatos pedidos no hay nada que generar
      Dado que la raíz del proyecto está vacía
      Y ningún formato activo
      Cuando calculo qué formatos salen
      Entonces no sale ningún formato

    # La matriz completa en un esquema: cada palanca produce su formato y sólo
    # el suyo. Es el caso que se repite en cada proyecto nuevo.

    Esquema del escenario: Pedir un formato lo genera
      Dado que la raíz del proyecto está vacía
      Y ningún formato activo
      Y el formato <formato> está generating
      Cuando calculo qué formatos salen
      # Uno pedido, uno generado.
      Entonces los formatos que salen son:
        """
        <esperado>
        """

      Ejemplos:
        | formato | esperado |
        | latex | latex |
        | pdf | pdf |
        | html | html |
        | epub | epub |
        | markdown | markdown |

    # Varios a la vez: un libro que sale en PDF y HTML no es un caso raro, es el
    # normal.
    Escenario: Varios formatos a la vez
      Dado que la raíz del proyecto está vacía
      Y los formatos "latex, html, markdown" están generating
      Cuando calculo qué formatos salen
      Entonces los formatos activos son "latex, html, markdown"

    # `merge` es un matiz del markdown exportado, no un formato por sí solo: un
    # proyecto que sólo quiere fusionar los `.md` no está pidiendo un formato
    # nuevo, y `generate: false` manda.
    Escenario: Merge sin generate no genera markdown
      Dado que la raíz del proyecto está vacía
      Y ningún formato activo
      Y el formato markdown sólo pide merge
      Cuando calculo qué formatos salen
      # Pedir la fusión no es pedir el formato.
      Entonces no sale ningún formato