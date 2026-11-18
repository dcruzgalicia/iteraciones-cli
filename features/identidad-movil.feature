Característica: la identidad del sitio en móvil

  Para que la cabecera y el pie se lean centrados en pantallas pequeñas
  Quiero centrar la marca y las acciones por debajo de sm

  Regla de negocio: La marca y los chips se centran en móvil

    Escenario: La marca se centra en cabecera y pie
      Cuando leo el CSS de identidad
      Entonces el bloque móvil centra la marca de cabecera y pie

    Escenario: Las acciones se centran en cabecera y pie
      Cuando leo el CSS de identidad
      Entonces el bloque móvil centra las acciones de cabecera y pie

  Regla de negocio: La tipografía de la marca crece con el breakpoint

    Escenario: En móvil el título y la descripción son legibles
      Cuando leo el CSS de identidad
      Entonces el título de la identidad mide 1.25rem en móvil
      Y el lema de la identidad mide 0.875rem en móvil

    Escenario: En sm el título y la descripción crecen un paso
      Cuando leo el CSS de identidad
      Entonces el título de la identidad mide 1.375rem en sm
      Y el lema de la identidad mide 0.9375rem en sm

    Escenario: En lg el título y la descripción crecen otro paso
      Cuando leo el CSS de identidad
      Entonces el título de la identidad mide 1.5rem en lg
      Y el lema de la identidad mide 1rem en lg
