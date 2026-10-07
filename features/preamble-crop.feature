# language: es
Característica: el sangrado del crop

  Como quien imprime en una imprenta
  Quiero que el papel lleve 6 mm de sangrado
  Para que el borde de color no llegue al filo del corte

  Regla de negocio: El crop lleva 6 mm de sangrado

    Esquema del escenario: El crop suma el sangrado al papel
      Dado que la raíz del proyecto está vacía
      Dado que el proyecto tiene los filtros:
      """
      <filtros>
      """
      Cuando detecto el tamaño del papel
      Y compongo el contenido del crop
      Entonces el crop trae "<medida>"

      Ejemplos:
        | filtros | medida |
        | 01-documentclass \documentclass{scrbook} | width=221.9truemm,height=285.4truemm |
        | 01-documentclass \documentclass[paper=a4]{scrbook} | width=216.0truemm,height=303.0truemm |
