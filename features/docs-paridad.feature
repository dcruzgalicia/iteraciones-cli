# language: es
Característica: los escenarios de la suite comprueban algo

  Como quien mantiene la suite
  Quiero que ningún escenario pase en verde sin comprobar nada
  Para que el verde signifique que el comportamiento está verificado

  Regla de negocio: Ningún escenario comprueba nada

    # El equivalente Gherkin de `check-tautologias`: un `Escenario` sin ningún
    # paso de comprobación pasa en verde para siempre.

    Escenario: Todo escenario tiene al menos una comprobación
      Entonces ningún escenario se queda sin comprobar

  Regla de negocio: Todos los features parsean

    # El dialecto `es` sólo vale si el parser oficial acepta los 90 ficheros.
    # Un `Cuando` mal escrito pasa en el `--dry-run` de cucumber y rompe en
    # runtime, en un escenario distinto del que lo introdujo.

    Escenario: Ningún feature se sale del dialecto
      Entonces el parser oficial de Gherkin acepta todos los features
