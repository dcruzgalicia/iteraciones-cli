# language: es
Característica: editar una creadora reconstruye las collections que la listan

  Como quien edita la bio de una colaboradora
  Quiero que el PDF de la antología se rehaga sin pedírselo
  Para que el lector no se encuentre con firmas de una versión anterior

  Regla de negocio: Una creadora es dependencia de las collections que la nombran

    Escenario: Editar la creadora arrastra a la collection
      Dado que el proyecto tiene una collection con una creadora
      Cuando construyo el proyecto con sus creators
      Y edito el archivo de la creadora
      Y construyo el proyecto con sus creators otra vez
      Entonces se reconstruyen 2 documentos

    Escenario: La collection guarda a quién debe su bloque de autoras
      Dado que el proyecto tiene una collection con una creadora
      Cuando construyo el proyecto con sus creators
      Entonces la collection "coleccion.md" declara las creator docs "ana.md"

    Escenario: Editar un miembro de files[] sigue reconstruyendo la collection
      Dado que el proyecto tiene una collection con una creadora
      Cuando construyo el proyecto con sus creators
      Y edito un miembro de files[] de la collection
      Y construyo el proyecto con sus creators otra vez
      Entonces se reconstruyen 2 documentos

  Regla de negocio: Romper el vínculo por nombre también reconstruye

    Escenario: Cambiar el name de la creadora arrastra a la collection
      Dado que el proyecto tiene una collection con una creadora
      Cuando construyo el proyecto con sus creators
      Y cambio el nombre de la creadora
      Y construyo el proyecto con sus creators otra vez
      Entonces se reconstruyen 2 documentos
      Y la collection "coleccion.md" declara las creator docs ""

    Escenario: Borrar la creadora arrastra a la collection
      Dado que el proyecto tiene una collection con una creadora
      Cuando construyo el proyecto con sus creators
      Y borro el archivo de la creadora
      Y construyo el proyecto con sus creators otra vez
      Entonces se reconstruyen 1 documentos

  Regla de negocio: No se arrastra lo que no es dependencia

    Escenario: Una creadora que no coincide con nadie no arrastra nada
      Dado que el proyecto tiene una collection con una creadora
      Cuando construyo el proyecto con sus creators
      Y agrego una creadora que no coincide con nadie
      Y construyo el proyecto con sus creators otra vez
      Entonces se reconstruyen 1 documentos
      Y la collection "coleccion.md" declara las creator docs "ana.md"

    Escenario: Sin tocar nada no se reconstruye nada
      Dado que el proyecto tiene una collection con una creadora
      Cuando construyo el proyecto con sus creators
      Y construyo el proyecto con sus creators otra vez
      Entonces se reconstruyen 0 documentos

  Regla de negocio: La collection con un miembro nuevo se entera

    Escenario: Un miembro nuevo recompila la collection y no toca a la creadora
      Dado que el proyecto tiene una collection con una creadora
      Cuando construyo el proyecto con sus creators
      Y agrego un miembro nuevo a la collection
      Y construyo el proyecto con sus creators otra vez
      Entonces se reconstruyen 2 documentos
