# language: es
Característica: el build parcial produce lo mismo que el completo

  Como quien itera sobre un capítulo
  Quiero compilar sólo ese capítulo y obtener exactamente lo mismo
  Para no esperar el libro entero y no tener que desconfiar del resultado

  Regla de negocio: El build parcial da los mismos bytes que el completo

    Escenario: Un build de un capítulo sale idéntico al completo
      Dado que la raíz del proyecto está vacía
      Y que los paths a compilar son "cap1.md"
      Cuando hago un build solo de los paths indicados
      Y que guardo la referencia del dist
      Y que borro el estado del build
      Cuando hago un build completo
      Entonces el dist sale byte a byte igual que la referencia

    Escenario: Los documentos no seleccionados no cambian
      Dado que la raíz del proyecto está vacía
      Y que los paths a compilar son "cap1.md"
      Cuando hago un build solo de los paths indicados
      Y que guardo la referencia del dist
      Y que borro el estado del build
      Cuando hago un build solo de los paths indicados
      Entonces los documentos no seleccionados no cambian

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

    Escenario: Varios paths en la misma corrida
      Dado que la raíz del proyecto está vacía
      Y que los paths a compilar son "cap1.md, cap2.md"
      Cuando hago un build solo de los paths indicados
      Y que guardo la referencia del dist
      Y que borro el estado del build
      Cuando hago un build completo
      Entonces el dist sale byte a byte igual que la referencia