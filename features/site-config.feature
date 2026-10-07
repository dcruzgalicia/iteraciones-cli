# language: es
Característica: qué formatos se generan

  Como quien escribe un libro que sólo necesita PDF
  Quiero que la configuración diga una sola cosa por formato
  Para no pedir un PDF sin haber pedido el LaTeX que lo produce

  Regla de negocio: Cada formato que se pide, se genera

    Escenario: Sin formatos pedidos no hay nada que generar
      Dado que la raíz del proyecto está vacía
      Y ningún formato activo
      Cuando calculo qué formatos salen
      Entonces no sale ningún formato

    Esquema del escenario: Pedir un formato lo genera
      Dado que la raíz del proyecto está vacía
      Y ningún formato activo
      Y el formato <formato> está generating
      Cuando calculo qué formatos salen
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

    Escenario: Varios formatos a la vez
      Dado que la raíz del proyecto está vacía
      Y los formatos "latex, html, markdown" están generating
      Cuando calculo qué formatos salen
      Entonces los formatos activos son "latex, html, markdown"

    Escenario: Merge sin generate no genera markdown
      Dado que la raíz del proyecto está vacía
      Y ningún formato activo
      Y el formato markdown sólo pide merge
      Cuando calculo qué formatos salen
      Entonces no sale ningún formato