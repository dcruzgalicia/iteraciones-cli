# language: es
Característica: las fronteras del builder

  Como quien mantiene el pipeline
  Quiero que el hash de un build sea el mismo siempre
  Para no recompilar un proyecto que no ha cambiado

  Regla de negocio: El hash tiene que ser determinista

    Escenario: Dos llamadas seguidas dan el mismo hash
      Dado que la raíz del proyecto está vacía
      Cuando calculo el hash de los filtros
      Y anoto el hash de los filtros
      Cuando calculo el hash de los filtros
      Entonces el hash de los filtros es el mismo de antes

    Escenario: Dos llamadas seguidas del mismo .bib dan el mismo hash
      Dado que la raíz del proyecto está vacía
      Y un proyecto con bibliografía y un CSL propio
      Cuando calculo el hash de la bibliografía sin CSL
      Y anoto el hash de la bibliografía
      Cuando calculo el hash de la bibliografía sin CSL
      Entonces el hash de la bibliografía es el mismo de antes

  Regla de negocio: La versión de pandoc cambia el hash

    Escenario: Dos versiones de pandoc dan hashes distintos
      Dado que la raíz del proyecto está vacía
      Cuando calculo el hash de los filtros
      Entonces anoto el hash de los filtros
      Cuando calculo el hash de los filtros con pandoc "pandoc 3.1.9"
      Y el hash de los filtros es distinto del anterior
      Y anoto el hash de los filtros
      Cuando calculo el hash de los filtros con pandoc "pandoc 3.2.0"
      Y el hash de los filtros es distinto del anterior

    Escenario: La caché del hash no se queda vacía
      Dado que la raíz del proyecto está vacía
      Cuando calculo el hash de los filtros
      Entonces la caché del hash de los filtros no está vacía

  Regla de negocio: El CSL empaquetado sólo pesa si el proyecto no trae el suyo

    Escenario: Poner un CSL propio cambia el hash de la bibliografía
      Dado que la raíz del proyecto está vacía
      Y un proyecto con bibliografía y un CSL propio
      Cuando calculo el hash de la bibliografía sin CSL
      Entonces anoto el hash de la bibliografía
      Cuando calculo el hash de la bibliografía con CSL
      Y el hash de la bibliografía es distinto del anterior

  Regla de negocio: Un build sin trabajo no reescribe el estado

    Escenario: El segundo build no toca state.json
      Dado que la raíz del proyecto está vacía
      Y un proyecto de prueba con un documento
      Cuando el orquestador construye el proyecto
      Entonces el estado tiene la fecha del build anterior
      Cuando el orquestador construye el proyecto otra vez
      Y el estado no se ha vuelto a escribir