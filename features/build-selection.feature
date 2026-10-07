# language: es
Característica: el build parcial produce lo mismo que el completo

  Como quien itera sobre un capítulo
  Quiero compilar sólo ese capítulo y obtener exactamente lo mismo
  Para no esperar el libro entero y no tener que desconfiar del resultado

  # Tramo 26 de la migración. 6 de los 18 casos de `build-selection.test.ts`.
  # Los que necesitan pandoc real y la CLI se quedan.

  # La prueba fuerte es que el archivo salga IDÉNTICO, no que contenga el texto
  # esperado. Un `toContain` pasa con un PDF a medio generar; una comparación
  # de bytes no. Y un PDF que se ve igual y pesa distinto es un PDF que la
  # imprenta rechaza.

  # Por eso la comparación es entre DOS proyectos: uno compilado entero y otro
  # compilado en parcial. Si se comparara el parcial consigo mismo tras dos
  # corridas, un bug que afecta a los dosaría por igual y pasaría.

  Regla de negocio: El build parcial da los mismos bytes que el completo

    Escenario: Un build de un capítulo sale idéntico al completo
      Dado que la raíz del proyecto está vacía
      Y que los paths a compilar son "cap1.md"
      Cuando hago un build solo de los paths indicados
      Y que guardo la referencia del dist
      Y que borro el estado del build
      Cuando hago un build completo
      Entonces el dist sale byte a byte igual que la referencia

    # Un build de un solo capítulo deja el resto de `dist` como estaba: el autor
    #iteró sobre un capítulo y no quiere que los demás se regeneren ni se
    # borren.
    Escenario: Los documentos no seleccionados no cambian
      Dado que la raíz del proyecto está vacía
      Y que los paths a compilar son "cap1.md"
      Cuando hago un build solo de los paths indicados
      Y que guardo la referencia del dist
      Y que borro el estado del build
      Cuando hago un build solo de los paths indicados
      Entonces los documentos no seleccionados no cambian

    # Dos parciales seguidos dejan el mismo `dist` que uno solo: el segundo no
    # rehace el primero ni lo borra.
    Escenario: Dos build parciales seguidos dejan el mismo dist
      Dado que la raíz del proyecto está vacía
      Y que los paths a compilar son "cap1.md"
      Cuando hago un build solo de los paths indicados
      Y que guardo la referencia del dist
      Y que borro el estado del build
      Cuando hago un build solo de los paths indicados
      Y que borro el estado del build
      Cuando hago un build solo de los paths indicados
      Entonces el dist sale byte a byte igual que la referencia

    # Varios paths en la misma corrida: es el caso normal de quien arregla tres
    # capítulos y no quiere tres builds.
    Escenario: Varios paths en la misma corrida
      Dado que la raíz del proyecto está vacía
      Y que los paths a compilar son "cap1.md, cap2.md"
      Cuando hago un build solo de los paths indicados
      Y que guardo la referencia del dist
      Y que borro el estado del build
      Cuando hago un build completo
      Entonces el dist sale byte a byte igual que la referencia