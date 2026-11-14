Característica: detectar el espaciado defectuoso de un PDF

  Como quien revisa la maqueta de un libro justificado
  Quiero que el informe vea las líneas estiradas, las comprimidas y los ríos
  Para no encontrarlos a ojo

  Regla de negocio: Una línea justificada con los espacios fuera de rango

    Escenario: Una línea estirada y una comprimida
      Dado una página de cajas con estas líneas:
        """
        [
          {"words": [["uno", 0, 20], ["dos", 22.5, 40], ["tres", 42.5, 60], ["cuatro", 62.5, 80], ["cinco", 82.5, 100]]},
          {"words": [["uno", 0, 20], ["dos", 22.5, 40], ["tres", 42.5, 60], ["cuatro", 62.5, 80], ["cinco", 82.5, 100]]},
          {"words": [["uno", 0, 20], ["dos", 25, 40], ["tres", 45, 60], ["cuatro", 65, 80], ["cinco", 85, 100]]},
          {"words": [["uno", 0, 20], ["dos", 21.4, 40], ["tres", 41.4, 60], ["cuatro", 61.4, 80], ["cinco", 81.4, 100]]}
        ]
        """
      Cuando analizo el espaciado de "stretched-line,shrunk-line"
      Entonces las incidencias de espaciado son:
        """
        stretched-line ;; pág 1 ;; línea 3 ;; ratio 2.00 ;; gap 5.0 ;; uno dos tres cuatro cinco
        shrunk-line ;; pág 1 ;; línea 4 ;; ratio 0.56 ;; gap 1.4 ;; uno dos tres cuatro cinco
        """

  Regla de negocio: Un canal blanco de tres líneas seguidas es un río

    Escenario: Tres líneas con el mismo hueco alineado
      Dado una página de cajas con estas líneas:
        """
        [
          {"words": [["uno", 0, 20], ["dos", 22.5, 40], ["tres", 42, 60], ["cuatro", 62.5, 80], ["cinco", 82.5, 100]]},
          {"words": [["seis", 0, 20], ["siete", 22.5, 40], ["ocho", 42, 60], ["nueve", 62.5, 80], ["diez", 82.5, 100]]},
          {"words": [["once", 0, 20], ["doce", 22.5, 40], ["trece", 42, 60], ["catorce", 62.5, 80], ["quince", 82.5, 100]]}
        ]
        """
      Cuando analizo el espaciado
      Entonces las incidencias de espaciado son:
        """
        river ;; pág 1 ;; líneas 1-3 ;; x 21.3 ;; canal 2.5 ;; uno dos tres cuatro cinco || once doce trece catorce quince
        river ;; pág 1 ;; líneas 1-3 ;; x 41.0 ;; canal 2.0 ;; uno dos tres cuatro cinco || once doce trece catorce quince
        river ;; pág 1 ;; líneas 1-3 ;; x 61.3 ;; canal 2.5 ;; uno dos tres cuatro cinco || once doce trece catorce quince
        river ;; pág 1 ;; líneas 1-3 ;; x 81.3 ;; canal 2.5 ;; uno dos tres cuatro cinco || once doce trece catorce quince
        """

    Escenario: El índice y las líneas de menos de cuatro palabras no cuentan
      Dado una página de cajas con estas líneas:
        """
        [
          {"words": [["uno", 0, 20], ["dos", 22.5, 40], ["tres", 42, 60], ["cuatro", 62.5, 80], ["cinco", 82.5, 100]]},
          {"words": [["seis", 0, 20], ["siete", 22.5, 40], ["ocho", 42, 60], ["nueve", 62.5, 80], ["diez", 82.5, 100]]},
          {"words": [["...", 0, 20], [".", 22.5, 40], [".", 42, 60], [".", 62.5, 80], [".", 82.5, 100]]},
          {"words": [["uno", 0, 20], ["dos", 22.5, 40], ["tres", 42, 60]]}
        ]
        """
      Cuando analizo el espaciado
      Entonces no hay incidencias de espaciado

  Regla de negocio: El XML de pdftotext -bbox-layout se lee

    Escenario: Una línea con dos palabras
      Dado un XML de cajas:
        """
        <page width="100" height="100">
          <line xMin="0" yMin="0" xMax="10" yMax="5">
            <word xMin="0" yMin="0" xMax="4" yMax="5">Hola</word>
            <word xMin="5" yMin="0" xMax="10" yMax="5">mundo</word>
          </line>
        </page>
        """
      Entonces la primera línea de la primera página dice "Hola mundo"
