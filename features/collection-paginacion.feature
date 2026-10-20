# language: es
Característica: La paginación de las colecciones

  Como quien publica una antología de cuarenta textos
  Quiero la colección repartida en páginas
  Para no cargar un scroll infinito

  Regla de negocio: Diez tarjetas por página

    Escenario: Con diez miembros hay una sola página
      Dado que la colección tiene 10 miembros
      Y que la colección tiene el cuerpo propio:
      """
      """
      Cuando compogo las páginas de la colección con 10 por página
      Entonces hay 1 páginas
      Y la página 1 tiene 10 tarjetas

    Escenario: Con once miembros hay dos páginas
      Dado que la colección tiene 11 miembros
      Y que la colección tiene el cuerpo propio:
      """
      """
      Cuando compogo las páginas de la colección con 10 por página
      Entonces hay 2 páginas
      Y la página 1 tiene 10 tarjetas
      Y la página 2 tiene 1 tarjetas

    Escenario: El corte lo manda la configuración
      Dado que la colección tiene 5 miembros
      Y que la colección tiene el cuerpo propio:
      """
      """
      Cuando compogo las páginas de la colección con 2 por página
      Entonces hay 3 páginas
      Y la página 3 tiene 1 tarjetas

    Escenario: El cuerpo propio de la colección va en la primera página
      Dado que la colección tiene 3 miembros
      Y que la colección tiene el cuerpo propio:
      """
      Introducción de la antología.
      """
      Cuando compogo las páginas de la colección con 2 por página
      Entonces la página 1 dice "Introducción de la antología."
      Y la página 2 no dice "Introducción de la antología."

  Regla de negocio: El nav son dos botones flotantes

    Escenario: La primera página sólo tiene el botón de siguiente
      Dado que la colección tiene 3 miembros
      Y que la colección tiene el cuerpo propio:
      """
      """
      Cuando compogo las páginas de la colección con 2 por página
      Entonces el nav de la página 1 no enlaza a "←"
      Y el nav de la página 1 enlaza a "→"
      Y el nav de la página 1 no dice "Página"

    Escenario: La última página sólo tiene el botón de anterior
      Dado que la colección tiene 3 miembros
      Y que la colección tiene el cuerpo propio:
      """
      """
      Cuando compogo las páginas de la colección con 2 por página
      Entonces el nav de la página 2 enlaza a "←"
      Y el nav de la página 2 no enlaza a "→"

    Escenario: El nav flota al pie, como el botón de volver al principio
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y una colección con 5 miembros
      Y el proyecto pagina de 2 tarjetas
      Cuando hago un build del proyecto
      Entonces el nav de la página 2 es flotante
      Y el nav de la página 2 no está dentro del texto

    Escenario: Con una sola página no hay nav
      Dado que la colección tiene 3 miembros
      Y que la colección tiene el cuerpo propio:
      """
      """
      Cuando compogo las páginas de la colección con 10 por página
      Entonces el nav de la página 1 está vacío

  Regla de negocio: Los archivos se llaman por página

    Escenario: La primera página conserva el nombre y las demás se numeran
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y una colección con 5 miembros
      Y el proyecto pagina de 2 tarjetas
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/antologia.html" existe
      Y el archivo "dist/files/antologia-2.html" existe
      Y el archivo "dist/files/antologia-3.html" existe
      Y el archivo "dist/files/antologia-4.html" no existe

    Escenario: La segunda página tiene el botón de anterior
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y una colección con 5 miembros
      Y el proyecto pagina de 2 tarjetas
      Cuando hago un build del proyecto
      Entonces el archivo "dist/files/antologia-2.html" dice "←"
      Y el archivo "dist/files/antologia-2.html" dice "→"

    Escenario: El nav no va pegado al texto
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y una colección con 5 miembros
      Y el proyecto pagina de 2 tarjetas
      Cuando hago un build del proyecto
      Entonces el nav de la página 2 no está dentro del texto
