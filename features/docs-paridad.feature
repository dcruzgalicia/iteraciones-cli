# language: es
Característica: la documentación no se separará del código

  Como quien lee `docs/configuration.md` para configurar su proyecto
  Quiero que lo que el código acepta y lo que el documento dice sean lo mismo
  Para no descubrir en el build que la opción que leí no existe

  # La documentación de este proyecto es unusually prescriptive: `configuration.md`
  # lista cada clave, `architecture.md` publica la superficie de `build()` y el
  # `README` lleva los comandos. Eso sólo sirve si nada puede apartarse en
  # silencio.
  #
  # Aquí no hay `Cuando`: el objeto bajo prueba es un documento, y por eso el
  # sujeto es el texto — la misma clase que `builder-isolation.feature`. Ningún
  # paso edita un documento: todos fallan con la diferencia listada, que es lo
  # que hace falta para arreglarlo.
  #
  # Estas aserciones cubrían `src/__tests__/docs-config-integrity.test.ts` y
  # `frontmatter-matrix.test.ts`, que se fueron con la suite de `bun:test` sin
  # equivalente en Gherkin. Lo que se perdió no era un test: era el aviso de que
  # el documento ya no describe el programa.

  Regla de negocio: La configuración documentada es configuración válida

    # Un ejemplo que el loader rechaza es peor que no escribirlo: el autor copia
    # el bloque y el build le falla en la cara.

    Escenario: Ningún ejemplo de configuration.md es una configuración que el loader rechace
      Entonces todo bloque de configuración documentado es una configuración válida

  Regla de negocio: El schema y el documento declaran las mismas claves

    # En los dos sentidos. Una clave en el schema sin documentar es la que se
    # pudre: nadie la anuncia y aparece sola en el `.md` que genera `init`.
    # Una clave documentada que ya no existe es la que rompe a quien la copió.

    Escenario: Ninguna clave del schema quedó sin documentar, ni al revés
      Entonces todo campo del schema está documentado

  Regla de negocio: Los comandos del README existen en el CLI

    Escenario: Ningún `iteraciones <comando>` documentado es un comando fantasma
      Entonces todo comando documentado existe en el CLI

  Regla de negocio: La tabla de opciones de build() es la interfaz

    Escenario: Las opciones documentadas son exactamente las de BuildOptions
      Entonces las opciones de build documentadas son exactamente BuildOptions

  Regla de negocio: El frontmatter de referencia es la lista que el validador acepta

    # `KNOWN_FRONTMATTER_FIELDS` es lo que `validate` usa para decidir si una
    # clave es conocida. Un campo documentado que no está ahí se reporta como
    # inválido; uno que está y no se documenta, nadie lo encuentra.

    Escenario: Los campos de frontmatter documentados son los que valida el proyecto
      Entonces todo campo de frontmatter documentado existe en KNOWN_FRONTMATTER_FIELDS

  Regla de negocio: El gating no se contradice a sí mismo

    # El runner filtra por `@requires-<capability>`. Un tag que no mapea a nada
    # hace que cucumber corra el scenario en una máquina que no tiene la
    # herramienta y lo omita por el motivo equivocado — o que no lo omita.

    Escenario: Cada capability del gating se usa en algún feature y tiene su motivo
      Entonces cada capability del gating tiene su etiqueta y su razón

    Escenario: Ningún @requires- apunta a una capability que no existe
      Entonces ningún @requires- del repo mapea a una capability inexistente

    Escenario: Las razones de omisión no nombran capabilities que no existen
      Entonces la lista de capabilities y las de omitidos no se contradicen

  Regla de negocio: Ningún escenario comprueba nada

    # El equivalente Gherkin de `check-tautologias`: un `Escenario` sin ningún
    # `Entonces` pasa en verde para siempre. Los que se van de este feature
    # aparecen como `sin comprobar`.

    Escenario: Todo escenario tiene al menos una comprobación
      Entonces ningún escenario se queda sin comprobar
