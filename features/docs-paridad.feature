# language: es
Característica: los escenarios de la suite comprueban algo

  Como quien mantiene la suite
  Quiero que ningún escenario pase en verde sin comprobar nada
  Para que el verde signifique que el comportamiento está verificado

  Regla de negocio: Ningún escenario comprueba nada

    Escenario: Todo escenario tiene al menos una comprobación
      Entonces ningún escenario se queda sin comprobar

  Regla de negocio: Todos los features parsean

    Escenario: Ningún feature se sale del dialecto
      Entonces el parser oficial de Gherkin acepta todos los features
