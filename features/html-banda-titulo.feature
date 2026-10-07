# language: es
Característica: la banda de título nombra el tipo del documento y su portada

  Como quien abre un documento generado
  Quiero que la banda de arriba diga si es un texto, una colección o una creadora
  Para que sepa qué está leyendo sin inferirlo del contenido

  # Tramo 3 de la migración. 3 de los 16 casos que quedaban de `cli-layer`.

  Regla de negocio: La banda de título del documento

    # El chip de la banda es el `type` del documento con su nombre en
    # castellano: Texto, Colección, Creadora. No hay un chip genérico.
    #
    # Los campos de portada —`collectionCreatorPrefix`, `subject`— se escriben
    # en markdown y se renderizan como markdown igual que en la portada del
    # PDF. Si salieran en crudo, el asterisco y la comilla se verían en la
    # página y el autor pensaría que escribió mal.

    Escenario: El chip nombra el type de cada documento
      Dado que la raíz del proyecto tiene un documento de cada tipo
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el chip de la banda nombra el type de cada documento

    Escenario: Los campos de portada se renderizan como markdown
      Dado que la raíz del proyecto tiene una colección con portada en markdown
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y los campos de portada salen renderizados como markdown

    Escenario: Un título con comillas, dos puntos y un salto de línea no rompe el HTML
      Dado que la raíz del proyecto tiene un documento con un título inhomogéneo
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y un título inhomogéneo no rompe el HTML
