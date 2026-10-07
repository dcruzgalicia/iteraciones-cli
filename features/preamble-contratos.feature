# language: es
Característica: el idioma, la disabled list y las dependencias entre filtros

  Como quien prepara un PDF
  Quiero que el idioma del documento decida los guiones y las comillas
  Y que desactivar un filtro avise cuando rompe algo del que depende
  Para que el PDF salga con la tipografía del idioma y no con un error en silencio

  Regla de negocio: El idioma del documento decide el babel del PDF

    Esquema del escenario: El idioma del documento decide las opciones de babel
      Dado que el idioma del documento es "<idioma>"
      Entonces las opciones de babel del PDF son "<opciones>"

      Ejemplos:
        | idioma | opciones                                           |
        | es-MX  | spanish,mexico,es-noshorthands,es-noindentfirst    |
        | es     | spanish,es-noshorthands,es-noindentfirst            |
        | en     | english                                            |
        | en-US  | english                                            |
        | fr-CA  | french                                             |
        | xx-YY  | spanish,es-noshorthands,es-noindentfirst            |

    Escenario: Un idioma desconocido avisa una vez por build, no una por consulta
      Dado que el idioma del documento es "xx-YY"
      Entonces un idioma desconocido avisa una vez por build

  Regla de negocio: Desactivar un filtro rompe lo que depende de él

    Escenario: Sin disabled list no hay problemas
      Dado que los filtros desactivados son "ninguno"
      Entonces los problemas de dependencias están vacíos

    Escenario: Una disabled list vacía tampoco
      Dado que los filtros desactivados son "[]"
      Entonces los problemas de dependencias están vacíos

    Escenario: Desactivar 05-language sin 16-toc-styling es un error
      Dado que los filtros desactivados son '["05-language"]'
      Entonces los problemas de dependencias avisan que falta "16-toc-styling"

    Escenario: Desactivar ambos (05 y 16) no deja el error
      Dado que los filtros desactivados son '["05-language", "16-toc-styling"]'
      Entonces los problemas de dependencias no tienen errores

    Escenario: Con 99-pdfx activo y 08-hyperref desactivado nadie se queja de 99-pdfx
      Dado que los filtros desactivados son '["97-eso-pic", "98-crop", "08-hyperref"]'
      Entonces los problemas deDependencies no marcan 99-pdfx

  Regla de negocio: La lista efectiva de desactivados

    Escenario: Sin lista, el 08-hyperref se apaga por el 99-pdfx que está activo
      Dado que los filtros desactivados son "ninguno"
      Entonces la lista efectiva de desactivados trae "08-hyperref"

    Escenario: Con el 99-pdfx desactivado no hace falta apagar el hyperref
      Dado que los filtros desactivados son '["99-pdfx"]'
      Entonces la lista efectiva de desactivados no trae "08-hyperref"

    Escenario: El 08-hyperref ya desactivado no se agrega dos veces
      Dado que los filtros desactivados son '["08-hyperref"]'
      Entonces la lista efectiva de desactivados trae "08-hyperref" una sola vez

    Escenario: Con ambos desactivados no se agrega nada
      Dado que los filtros desactivados son '["99-pdfx", "08-hyperref"]'
      Entonces la lista efectiva de desactivados trae "99-pdfx"
      Y la lista efectiva de desactivados trae "08-hyperref" una sola vez

    Escenario: Los otros filtros de la lista se conservan
      Dado que los filtros desactivados son '["97-eso-pic", "98-crop"]'
      Entonces la lista efectiva de desactivados trae "97-eso-pic"
      Y la lista efectiva de desactivados trae "98-crop"
      Y la lista efectiva de desactivados trae "08-hyperref"

    Escenario: La resolución no muta la lista del config
      Dado que los filtros desactivados son '["97-eso-pic", "98-crop"]'
      Entonces la lista original de desactivados no cambió

  Regla de negocio: Un nombre de filtro que no existe se rechaza

    Escenario: Sin lista no hay nada que rechazar
      Dado que los filtros desactivados son "ninguno"
      Entonces validar esos filtros no dice nada

    Escenario: Una lista vacía tampoco
      Dado que los filtros desactivados son "[]"
      Entonces validar esos filtros no dice nada

    Escenario: Un nombre que existe pasa
      Dado que los filtros desactivados son '["15-hyphenation-rules"]'
      Entonces validar esos filtros no dice nada

    Escenario: Un nombre desconocido se rechaza diciendo cuál
      Dado que los filtros desactivados son '["99-no-existe"]'
      Entonces validar esos filtros dice que "99-no-existe" no existe