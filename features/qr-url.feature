# language: es
Característica: el QR y su URL

  Como quien pone un QR en el texto
  Quiero que se genere aunque la URL tenga parámetros
  Para que el lector lo escanee y no se quede sin él

  Regla de negocio: Una URL corriente genera su imagen

    Escenario: Una URL con & genera su JPG
      Dado que la raíz del proyecto está vacía
      Y un QR cuya URL lleva &
      Cuando renderizo el documento
      Entonces la carpeta de procesados tiene exactamente 1 archivo
      Y el único archivo es un QR en JPG
      Y el LaTeX apunta al JPG generado

  Regla de negocio: La URL no toca el shell

    Escenario: Una URL con ; no ejecuta nada
      Dado que la raíz del proyecto está vacía
      Y un QR cuya URL lleva un punto y coma
      Cuando renderizo el documento
      Entonces el marcador de inyección NO existe
      Y la carpeta de procesados tiene exactamente 1 archivo

  Regla de negocio: La caché por URL evita regenerar

    Escenario: Con la caché presente no se vuelve a generar
      Dado que la raíz del proyecto está vacía
      Y un QR cuya URL lleva &
      Cuando renderizo el documento
      Entonces dejo un sentinel en el JPG del QR
      Cuando vuelvo a renderizar el mismo documento
      Y el sentinel sigue intacto
      Y la carpeta de procesados tiene exactamente 1 archivo