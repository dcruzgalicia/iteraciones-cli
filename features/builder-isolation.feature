# language: es
Característica: las fronteras del builder

  Como quien mantiene el pipeline
  Quiero que el hash de un build sea el mismo siempre
  Para no recompilar un proyecto que no ha cambiado

  # Tramo 46 de la migración. 3 de los 10 casos de
  # `builder-isolation.test.ts`.

  # Siete de los diez casos de ese archivo NO migran, por decisión de #2550: leen
  # los `.ts` como TEXTO y escanean sus imports. El sujeto no es un
  # comportamiento en runtime sino una propiedad del árbol de dependencias —que
  # `src/builder` no importe de `src/cli`, que `state-hash` no dependa de un
  # compositor, que el orquestador no mute la config del usuario, que exista una
  # sola escritura de estado, que el pool drene antes de propagar—. No hay
  # `Cuando`: no hay acción que ejecutar. Encarnarlos en Gherkin obligaría a
  # inventar una acción para poder afirmar algo que no ocurre, así que se quedan
  # en `bun:test` con su razón escrita al lado.
  #
  # Estos tres sí migran: los hashes y el round-trip se llaman y se comparan, que
  # es exactamente un `Cuando` y un `Entonces`.

  Regla de negocio: El hash tiene que ser determinista

    # `computeFiltersHash` participa en la decisión "esto cambió". Si no fuera
    # determinista, dos builds seguidos del mismo proyecto darían hashes
    # distintos y el build recompilaría siempre sin motivo.

    Escenario: Dos llamadas seguidas dan el mismo hash
      Dado que la raíz del proyecto está vacía
      Cuando calculo el hash de los filtros
      Y anoto el hash de los filtros
      Cuando calculo el hash de los filtros
      Entonces el hash de los filtros es el mismo de antes

    # El hash de la bibliografía también: mismo `.bib`, mismo hash.
    Escenario: Dos llamadas seguidas del mismo .bib dan el mismo hash
      Dado que la raíz del proyecto está vacía
      Y un proyecto con bibliografía y un CSL propio
      Cuando calculo el hash de la bibliografía sin CSL
      Y anoto el hash de la bibliografía
      Cuando calculo el hash de la bibliografía sin CSL
      Entonces el hash de la bibliografía es el mismo de antes

  # --- Tramo 46: la versión de pandoc entra en el hash (#2024) ---

  # Dos máquinas con pandoc distinto producen PDF distintos para el mismo
  # markdown. Si la versión no entrara en el hash, el `dist` de una máquina daría
  # por bueno lo que otra construyó con otro pandoc.

  Regla de negocio: La versión de pandoc cambia el hash

    Escenario: Dos versiones de pandoc dan hashes distintos
      Dado que la raíz del proyecto está vacía
      Cuando calculo el hash de los filtros
      Entonces anoto el hash de los filtros
      Cuando calculo el hash de los filtros con pandoc "pandoc 3.1.9"
      Y el hash de los filtros es distinto del anterior
      Y anoto el hash de los filtros
      Cuando calculo el hash de los filtros con pandoc "pandoc 3.2.0"
      # Ni la primera ni la segunda se parecen a la base.
      Y el hash de los filtros es distinto del anterior

    # La caché de archivos no se contamina entre llamadas: si se contaminara, la
    # segunda llamada devolvería un hash de la primera y el build no detectaría
    # el cambio.
    Escenario: La caché del hash no se queda vacía
      Dado que la raíz del proyecto está vacía
      Cuando calculo el hash de los filtros
      # Con la caché llena, la siguiente llamada no vuelve a hashear el schema.
      Entonces la caché del hash de los filtros no está vacía

  Regla de negocio: El CSL empaquetado sólo pesa si el proyecto no trae el suyo

    Escenario: Poner un CSL propio cambia el hash de la bibliografía
      Dado que la raíz del proyecto está vacía
      Y un proyecto con bibliografía y un CSL propio
      Cuando calculo el hash de la bibliografía sin CSL
      Entonces anoto el hash de la bibliografía
      Cuando calculo el hash de la bibliografía con CSL
      # Sin CSL configurado participa el empaquetado; con él, deja de participar
      # y el hash cambia aunque el `.bib` sea el mismo.
      Y el hash de la bibliografía es distinto del anterior

  # --- Tramo 46: la escritura única del estado (#2025) ---

  # Un build sin trabajo no debe tocar `state.json`. Si lo tocara, el mtime
  # cambiaría y el siguiente build leería un estado "nuevo" para un proyecto que
  # no ha cambiado: el ciclo de recompilar sin motivo, siempre.

  Regla de negocio: Un build sin trabajo no reescribe el estado

    Escenario: El segundo build no toca state.json
      Dado que la raíz del proyecto está vacía
      Y un proyecto de prueba con un documento
      Cuando el orquestador construye el proyecto
      Entonces el estado tiene la fecha del build anterior
      Cuando el orquestador construye el proyecto otra vez
      Y el estado no se ha vuelto a escribir