# language: es
Característica: los metadatos del PDF

  Como quien recibe un PDF de una editorial
  Quiero que el título y los autores se lean bien en cualquier visor
  Para que el documento se cite correctamente

  Regla de negocio: El XMP sólo dice lo que hay

    Escenario: Emite los campos presentes, con separador para las listas
      Dado que la raíz del proyecto está vacía
      Y los metadatos son:
        """
        title=Pan {casero} & más ;; authors=Ana | Bet ;; lang=es-MX ;; dateIso=2026-08-08 ;; subject=Cocina ;; publishers=Editorial X | Otra
        """
      Cuando construyo el contenido XMP
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
      Entonces el XMP es exactamente:
        """
        \Keywords{uno\sep dos}<br>
        """

    Escenario: Sin campos el XMP está vacío
      Dado que la raíz del proyecto está vacía
      Y los metadatos son:
        """
        sinNada=
        """
      Cuando construyo el contenido XMP
      Entonces el XMP está vacío

  Regla de negocio: El bloque Info sólo lleva autor y keywords

    Escenario: El bloque lleva autor y keywords escapados
      Dado que la raíz del proyecto está vacía
      Y los metadatos son:
        """
        title=T ;; authors=Ana | Bet ;; subject=S ;; keywords=k | m
        """
      Cuando construyo el bloque Info
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

    Escenario: Sin campos el .tex queda igual
      Dado que la raíz del proyecto está vacía
      Y un .tex mínimo con ancla de documento
      Y los metadatos son:
        """
        sinNada=
        """
      Cuando inyecto los metadatos
      Entonces el .tex queda igual

    Escenario: Sin \begin{document} el .tex queda igual
      Dado que la raíz del proyecto está vacía
      Y un .tex sin ancla de documento
      Y los metadatos son:
        """
        title=T
        """
      Cuando inyecto los metadatos
      Entonces el .tex queda igual

  Regla de negocio: El Info dict convierte, el XMP no

    Escenario: Los autores acentuados salen como comandos LaTeX
      Dado que la raíz del proyecto está vacía
      Y los metadatos son:
        """
        title=T ;; authors=Muñoz | José Ángel ;; subject=S
        """
      Cuando construyo el bloque Info
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
      Entonces el XMP conserva el UTF-8 real