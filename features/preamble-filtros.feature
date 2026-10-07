# language: es
Característica: los filtros de preámbulo que maquetan el documento

  Como quien maquetó su libro con LaTeX
  Quiero que cada ajuste tipográfico venga de un filtro con nombre
  Para poder cambiar uno sin desarmar el resto, y saber cuál tocar

  # Tramo 8 de la migración. 12 de los 34 casos que quedaban de
  # `preamble.test.ts`.

  # Este feature usa docstrings y no `Examples`: los fragmentos son LaTeX con
  # llaves, y una tabla tendría que llevar los `\\` y los saltos escapados a
  # mano. Se lee mejor el LaTeX real que su versión escapada.

  Regla de negocio: La tipografía se afloja lo justo para que no corte palabras

    # LaTeX por defecto es tímido: se niega a cortar una palabra y prefiere dejar
    # un hueco feo al lado. Con `tolerance=400` (el default) y
    # `pretolerance=50` hay muy pocos puntos denip. Subir la tolerancia y
    # elasticidad es lo que hace que un texto justificado no tenga ríos.

    Escenario: La tolerancia de partición de palabras está subida
      Cuando miro el filtro "07-typography"
      Entonces el filtro trae:
      """
      \pretolerance=50
      """
      Y el filtro trae:
      """
      \tolerance=1000
      """
      Y el filtro trae:
      """
      \hyphenpenalty=50
      """
      Y el filtro no trae:
      """
      \tolerance=400
      """
      Y el filtro trae:
      """
      stretch=10,shrink=10
      """

  Regla de negocio: Los niveles de sección llevan su propio aire

    # Un libro con todos los niveles igual de pegado se lee como un documento
    # plano. Los niveles altos respiran; los bajos no, porque si no el cuerpo
    # queda cortado de reimbursed parrafitos.

    Escenario: Los niveles altos respiran y los bajos no
      Cuando miro el filtro "14-sectioning"
      Entonces el filtro trae:
      """
      beforeskip=2\baselineskip,afterskip=\baselineskip,afterindent=false]{part}
      """
      Y el filtro trae:
      """
      beforeskip=2\baselineskip,afterskip=\baselineskip,afterindent=false]{chapter}
      """
      Y el filtro trae:
      """
      beforeskip=2\baselineskip,afterskip=2\baselineskip,afterindent=false]{section}
      """
      Y el filtro trae:
      """
      beforeskip=2\baselineskip,afterskip=2\baselineskip,afterindent=false]{subsection}
      """
      Y el filtro trae:
      """
      beforeskip=\baselineskip,afterskip=\baselineskip,afterindent=false]{subsubsection}
      """

  Regla de negocio: El dictum se separa del texto

    Escenario: El epígrafe lleva dos líneas de aire
      Cuando miro el filtro "21-dictum"
      # Un baselineskip es poco: el epígrafe se lee como parte del párrafo.
      Entonces el filtro trae:
      """
      \topsep=2\baselineskip
      """
      Y el filtro no trae:
      """
      \topsep=\baselineskip
      """

  Regla de negocio: El índice con líneas guía y sin cajas

    Escenario: Las entradas del índice llevan su leaders
      Cuando miro el filtro "16-toc-styling"
      Entonces el filtro trae:
      """
      \BeforeTOCHead{\RedeclareSectionCommand[beforeskip=2\baselineskip,afterskip=\baselineskip,afterindent=false]{subsubsection}}
      """
      Y el filtro trae:
      """
      linefill=\TOCLineLeaderFill,beforeskip=2\baselineskip]{tocline}{part}
      """
      Y el filtro trae:
      """
      pagenumberformat=\normalsize\normalfont
      """
      Y el filtro no trae:
      """
      pagenumberbox=\phantom,indent=0pt,beforeskip=0pt]{tocline}{part}
      """

  Regla de negocio: Cada biblioteca se carga una vez y por su nombre

    Escenario: El subrayado, el tachado y el resaltado traen su biblioteca
      Cuando miro el filtro "29-text-decoration"
      # `normalem` es lo que hace que `soul` no barrese las cursivas.
      Entonces el filtro trae:
      """
      \usepackage[normalem]{ulem}
      """
      Y el filtro trae:
      """
      \usepackage{soul}
      """
      Y el filtro trae:
      """
      \sethlcolor{yellow}
      """

    Escenario: Las tablas sin caption necesitan un contador `none`
      Cuando miro el filtro "09-tables"
      # pandoc envuelve las tablas sin caption en \def\LTcaptype{none} y
      # longtable corre \refstepcounter{none}. Sin el contador, el build falla
      # con 'No counter "none" defined' — que fue lo que rompía el PDF del CV.
      Entonces el filtro trae:
      """
      \newcounter{none}
      """

    Escenario: Las marcas de corte no llevan texto de información
      Cuando miro el filtro "98-crop"
      # El texto de información aparece impreso en cada marca de la hoja
      # interior. En un PDF/X-1a es ruido y además cambia la caja.
      Entonces el filtro trae:
      """
      \usepackage[width=221.9truemm,height=285.4truemm,center,cam,noinfo]{crop}
      """

    Escenario: El alto del encabezado cabe en headsep
      Cuando miro el filtro "04-margins"
      # headsep y footskip salen del alto real del encabezado. Si no se
      # recalculan, el encabezado se encima con el texto.
      Entonces el filtro trae:
      """
      headheight=\baselineskip,headsep=3.25pt,footskip=10.25pt
      """

  Regla de negocio: El grid de fondo se activa en runtime, no con opciones

    # LaTeX fija las opciones de un paquete la PRIMERA vez que lo carga. Si
    # 97-eso-pic volviera a cargarlo con opciones y 30-startpaper ya lo había
    # cargado plano, eso es un option clash y el build para (#1962). Por eso
    # 97 activa el grid con \ESO@gridtrue y sus macros en vez de con opciones.

    Escenario: El grid no se carga con opciones
      Cuando miro el filtro "97-eso-pic"
      Entonces el filtro no trae:
      """
      \usepackage[
      """
      Y el filtro trae:
      """
      \ESO@gridtrue
      """
      Y el filtro trae:
      """
      \ESO@gridBGtrue
      """
      Y el filtro trae:
      """
      \ESO@texcoordtrue
      """
      Y el filtro trae:
      """
      \ESO@gridcolor{teal!50}
      """
      Y el filtro trae:
      """
      \ESO@subgridcolor{teal!30}
      """
      Y el filtro trae:
      """
      \g@addto@macro\ESO@HookIIIBG{\ESO@gridpicture}
      """

    Escenario: El startpaper carga eso-pic plano para que el grid pueda activarse
      Cuando miro el filtro "30-startpaper"
      Cuando miro además el filtro "97-eso-pic"
      Entonces el filtro trae:
      """
      \usepackage{eso-pic}
      """
      Y el filtro que miro además trae:
      """
      \ESO@gridtrue
      """