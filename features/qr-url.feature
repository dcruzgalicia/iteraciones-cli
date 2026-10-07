# language: es
Característica: el QR y su URL

  Como quien pone un QR en el texto
  Quiero que se genere aunque la URL tenga parámetros
  Para que el lector lo escanee y no se quede sin él

  # Tramo 53 de la migración. 3 de los 3 casos de `qr-url.test.ts`. El archivo
  # queda cerrado.

  # La URL del QR ya no pasa por el shell: va por stdin a `pandoc.pipe`, con el
  # png → jpg dentro de `qr-gen.ts` y caché por URL (`qr-<md5(url)>.jpg`).

  Regla de negocio: Una URL corriente genera su imagen

    # La regresión: antes la URL se interpolaba en `io.popen('echo ' .. url …)`. Un
    # `&` —que es lo normal en cualquier URL con más de un parámetro— partía la
    # línea de shell y el QR se iba en silencio. Sin imagen, sin error, sin aviso:
    # el LaTeX compilaba y el QR no salía.

    Escenario: Una URL con & genera su JPG
      Dado que la raíz del proyecto está vacía
      Y un QR cuya URL lleva &
      Cuando renderizo el documento
      # Sólo queda el .jpg: el png y el svg intermedios los consume el script.
      Entonces la carpeta de procesados tiene exactamente 1 archivo
      Y el único archivo es un QR en JPG
      Y el LaTeX apunta al JPG generado

  # La URL venía del frontmatter, o sea de quien escribe el documento. Con un `;`
  # el comando se cierra y el segundo se ejecuta. Por eso la URL no toca el
  # shell, y el escenario deja un marcador que, si se ejecutara algo, existiría.

  Regla de negocio: La URL no toca el shell

    Escenario: Una URL con ; no ejecuta nada
      Dado que la raíz del proyecto está vacía
      Y un QR cuya URL lleva un punto y coma
      Cuando renderizo el documento
      # El marcador NO aparece: el `;` es parte de la URL, no un separador.
      Entonces el marcador de inyección NO existe
      Y la carpeta de procesados tiene exactamente 1 archivo

  # La caché es por URL, no por documento: el mismo QR en dos documentos se
  # genera una vez. Y si ya está, no se regenera.

  Regla de negocio: La caché por URL evita regenerar

    Escenario: Con la caché presente no se vuelve a generar
      Dado que la raíz del proyecto está vacía
      Y un QR cuya URL lleva &
      Cuando renderizo el documento
      Entonces dejo un sentinel en el JPG del QR
      Cuando vuelvo a renderizar el mismo documento
      # Si se regenerara, el sentinel se pisaría: eso es lo que se comprueba.
      Y el sentinel sigue intacto
      Y la carpeta de procesados tiene exactamente 1 archivo