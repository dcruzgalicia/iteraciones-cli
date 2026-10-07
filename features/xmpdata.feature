# language: es
Característica: los metadatos del PDF

  Como quien recibe un PDF de una editorial
  Quiero que el título y los autores se lean bien en cualquier visor
  Para que el documento se cite correctamente

  # Tramo 42 de la migración. 11 de los 11 casos de `xmpdata.test.ts`. El archivo
  # queda cerrado.

  # XMP e Info dict son dos formatos con DOS REGLAS OPUESTAS para el mismo autor:
  #
  # - el **Info dict** es un diccionario de PostScript y los bytes acentuados
  #   crudos lo rompen (#2085): `Muñoz` tiene que salir `Mu\~{n}oz`;
  # - el **XMP** es XML, así que el UTF-8 real es lo correcto y convertirlo a
  #   comandos LaTeX lo ROMPE.
  #
  # Por eso los dos escenarios del final hay que leerlos juntos: si alguien
  # "unifica" el escaping, se rompe uno de los dos.

  Regla de negocio: El XMP sólo dice lo que hay

    Escenario: Emite los campos presentes, con separador para las listas
      Dado que la raíz del proyecto está vacía
      Y los metadatos son:
        """
        title=Pan {casero} & más ;; authors=Ana | Bet ;; lang=es-MX ;; dateIso=2026-08-08 ;; subject=Cocina ;; publishers=Editorial X | Otra
        """
      Cuando construyo el contenido XMP
      # Las llaves y el ampersand se escapan para TeX, y las listas llevan `\sep`.
      Entonces el XMP es exactamente:
        """
        \Title{Pan \{casero\} \& más}<br>\Author{Ana\sep Bet}<br>\Language{es-MX}<br>\Subject{Cocina}<br>\Date{2026-08-08}<br>\Publisher{Editorial X\sep Otra}<br>
        """

    Escenario: Los keywords salen si los hay
      Dado que la raíz del proyecto está vacía
      Y los metadatos son:
        """
        keywords=uno | dos
        """
      Cuando construyo el contenido XMP
      # `\Keywords` es opcional: sin él el XMP es más corto y no dice menos.
      Entonces el XMP es exactamente:
        """
        \Keywords{uno\sep dos}<br>
        """

    # Sin campos, nada. Un `\Title{}` vacío hace que el visor muestre un título
    # en blanco, que es peor que no mostrar ninguno.
    Escenario: Sin campos el XMP está vacío
      Dado que la raíz del proyecto está vacía
      Y los metadatos son:
        """
        sinNada=
        """
      Cuando construyo el contenido XMP
      # El template omite los vacíos.
      Entonces el XMP está vacío

  Regla de negocio: El bloque Info sólo lleva autor y keywords

    # Title y Subject ya los cubre PDF/X; repetirlos aquí es ruido.

    Escenario: El bloque lleva autor y keywords escapados
      Dado que la raíz del proyecto está vacía
      Y los metadatos son:
        """
        title=T ;; authors=Ana | Bet ;; subject=S ;; keywords=k | m
        """
      Cuando construyo el bloque Info
      # `\pdfescapestring` porque un `(`, un `\` o un acento rompen el dict.
      Entonces el bloque Info es exactamente:
        """
        \AtBeginDocument{%<br>  \pdfinfo{%<br>    /Author (\pdfescapestring{Ana, Bet})%<br>    /Keywords (\pdfescapestring{k, m})%<br>  }%<br>}%<br>
        """

    Escenario: Sin autores no hay bloque
      Dado que la raíz del proyecto está vacía
      Y los metadatos son:
        """
        title=T
        """
      Cuando construyo el bloque Info
      # Un bloque con sólo campos que PDF/X ya cubre no aporta nada.
      Entonces el bloque Info está vacío

    Escenario: Sin campos el bloque está vacío
      Dado que la raíz del proyecto está vacía
      Y los metadatos son:
        """
        sinNada=
        """
      Cuando construyo el bloque Info
      Entonces el bloque Info está vacío

  Regla de negocio: La inyección va antes de \begin{document}

    # Después, el `filecontents` ya no se escribe a tiempo y el PDF sale sin
    # metadatos: el .tex compila, el PDF parece correcto y no tiene título.

    Escenario: El filecontents precede al cuerpo del documento
      Dado que la raíz del proyecto está vacía
      Y un .tex mínimo con ancla de documento
      Y los metadatos son:
        """
        title=T ;; authors=Ana | Bet
        """
      Cuando inyecto los metadatos
      Entonces el .tex lleva el fragmento:
        """
        \begin{filecontents}[overwrite]{\jobname.xmpdata}<br>\Title{T}<br>\Author{Ana\sep Bet}<br>\end{filecontents}<br>
        """
      Y el .tex lleva el fragmento:
        """
        /Author (\pdfescapestring{Ana, Bet})%
        """
      Y el filecontents va antes del ancla de documento

    # Sin campos no se toca el `.tex`: un cambio sin motivo puede descolocar un
    # documento que ya estaba bien.
    Escenario: Sin campos el .tex queda igual
      Dado que la raíz del proyecto está vacía
      Y un .tex mínimo con ancla de documento
      Y los metadatos son:
        """
        sinNada=
        """
      Cuando inyecto los metadatos
      # Ni una comilla de diferencia.
      Entonces el .tex queda igual

    # Sin el ancla no hay dónde insertar: se devuelve tal cual en vez de
    # inventar un sitio.
    Escenario: Sin \begin{document} el .tex queda igual
      Dado que la raíz del proyecto está vacía
      Y un .tex sin ancla de documento
      Y los metadatos son:
        """
        title=T
        """
      Cuando inyecto los metadatos
      # No hay ancla, no hay cambio.
      Entonces el .tex queda igual

  # --- Tramo 42: el blindaje del mojibake (#2085) ---

  Regla de negocio: El Info dict convierte, el XMP no

    Escenario: Los autores acentuados salen como comandos LaTeX
      Dado que la raíz del proyecto está vacía
      Y los metadatos son:
        """
        title=T ;; authors=Muñoz | José Ángel ;; subject=S
        """
      Cuando construyo el bloque Info
      # Es un diccionario de PostScript: los bytes UTF-8 crudos lo corrompen.
      Entonces el bloque Info lleva el fragmento:
        """
        \pdfescapestring{Mu\~{n}oz, Jos\'{e} \'{A}ngel}
        """
      Y el bloque Info NO lleva bytes acentuados crudos

    Escenario: El XMP conserva el UTF-8 real
      Dado que la raíz del proyecto está vacía
      Y los metadatos son:
        """
        title=Año del jalapeño ;; authors=Núñez
        """
      Cuando construyo el contenido XMP
      # Es XML: aquí los comandos LaTeX ROMPERÍAN el texto.
      Entonces el XMP conserva el UTF-8 real