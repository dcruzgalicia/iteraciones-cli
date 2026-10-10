# language: es
@requires-pandoc
Característica: Los filtros Lua del proyecto definen el contrato del markdown
  Como quien escribe un documento y espera que el build lo convierta
  Quiero saber exactamente qué produce cada construcción
  Para poder confiar en que el markdown de entrada llega como escribo

  Regla de negocio: Filtros Lua de LaTeX
    El markdown entra por el lector estándar de pandoc salvo que el caso pida `markdown+mark`.

    Esquema del escenario: Los filtros de LaTeX hacen lo que el markdown pide
      Dado el caso de LaTeX "<caso>"
      Cuando lo convierto a LaTeX
      Entonces cumple las expectativas guardadas

      Ejemplos:
        | caso |
        | agrega-noindent-al-parrafo-posterior-a-un-blockquote |
        | convierte-chinese-y-korean-con-sus-encodings-gbsn-ksc |
        | convierte-dentro-de-un-blockquote-en-vspace-antes-desapareci |
        | convierte-dentro-de-una-lista-en-vspace-antes-se-imprimia-li |
        | convierte-div-center-y-div-flushright |
        | convierte-div-dictum-con-autor |
        | convierte-div-dictum-sin-autor |
        | convierte-div-verse-sin-vspace-externo |
        | convierte-en-vspace-baselineskip |
        | convierte-en-vspace-noindent-al-parrafo-siguiente |
        | convierte-japanese-al-entorno-cjk-con-encoding-min |
        | decoracion-inline-versalitas-mayusculas-subrayado-resaltado- |
        | detecta-el-punto-final-aunque-la-ultima-palabra-lleve-un-nbs |
        | dictum-con-autor-de-dos-parrafos-los-separa-con-espacio |
        | dictum-con-autor-enlazado-conserva-el-autor-antes-desapareci |
        | dictum-con-autor-entre-comillas-tipograficas-conserva-el-aut |
        | mbox-cuenta-las-palabras-de-resaltado-mark-como-grupo |
        | mbox-envuelve-fuera-del-span-uppercase-makeuppercase-no-pene |
        | mbox-sentence-end-con-comillas-tipograficas-wrap-interno-den |
        | mbox-sentence-end-con-enfasis-de-1-palabra-al-final-extiende |
        | mbox-sentence-end-con-enfasis-de-2-palabras-al-final-el-mbox |
        | mbox-sentence-end-con-enfasis-final-wrap-interno-dentro-del- |
        | mbox-sentence-end-con-negritas-de-1-palabra-extiende-hacia-a |
        | mbox-sentence-end-con-negritas-de-2-palabras-grupo-completo- |
        | mbox-sentence-end-con-negritas-de-4-palabras-wrap-interno-de |
        | mbox-sentence-end-solo-envuelve-las-ultimas-3-palabras-de-la |
        | mbox-words-nohyph-deja-la-puntuacion-fuera-del-mbox |
        | mbox-words-nohyph-dentro-del-enfis-al-que-se-apunta |
        | mbox-words-nohyph-envuelve-la-palabra-indicada |
        | mbox-words-nohyph-envuelve-varias-palabras-en-el-mismo-parrafo |
        | mbox-words-nohyph-una-palabra-que-no-esta-no-rompe-nada |
        | mbox-words-runt-2-engloba-las-ultimas-2-palabras |
        | mbox-words-runt-3-engloba-las-ultimas-3-palabras |
        | mbox-words-runt-con-enfis-al-final-envuelve-dentro-del-grupo |
        | mbox-words-runt-conserva-el-punto-final-dentro-del-mbox |
        | mbox-words-runt-no-toca-un-parrafo-con-tantas-palabras-como-pide |
        | no-agrega-noindent-si-el-quote-no-es-seguido-por-un-parrafo |
        | no-corta-la-oracion-en-abreviaturas-de-meses-ni-en-p-ej |
        | no-modifica-parrafos-de-menos-de-5-palabras |
        | texto-uppercase-makeuppercase-texto-latex |

  Regla de negocio: Filtros Lua de HTML
    Cada Div con clase se envuelve en su elemento; el `::` se convierte en un div de altura fija.

    Esquema del escenario: Los filtros de HTML envuelven cada bloque con su clase
      Dado el caso de HTML "<caso>"
      Cuando lo convierto a HTML
      Entonces cumple las expectativas guardadas

      Ejemplos:
        | caso |
        | convierte-dentro-de-una-lista-a-div-spacer-nunca-literal |
        | convierte-div-spacer-en-div-vacio-con-los-filtros-semanticos |
        | envuelve-div-center-en-div |
        | envuelve-div-dictum-en-blockquote-con-bloques-nativos |
        | envuelve-div-flushright-en-div |
        | envuelve-div-verse-en-div |
        | no-altera-parrafos-normales |

  Regla de negocio: El filtro internal/flags detecta el tipo del primer bloque
    El filtro decide si el documento "empieza con contenido": un Header o un
    RawBlock de sección cuentan como inicio, un Para no. De ahí salen el índice,
    el vspace inicial y el `noindent`.

    Esquema del escenario: El filtro structural responde al primer bloque
      Dado el caso de flags "<caso>"
      Cuando lo convierto con el filtro de flags
      Entonces cumple las expectativas guardadas

      Ejemplos:
        | caso |
        | con-el-primer-bloque-header-toc-presente-sin-vspace-ni-noind |
        | con-el-primer-bloque-para-el-comando-de-pagina-no-se-inserta |
        | con-el-primer-bloque-para-sin-toc-con-vspace-y-noindent |
        | div-center-no-cuenta-como-inicio-de-lista-el-vspace-se-manti |
        | headings-dentro-de-un-div-activan-el-toc-recorrido-completo- |
        | no-agrega-printbibliography-si-biblatex-no-esta-disponible-1 |
        | no-agrega-printbibliography-sin-nodos-cite-aunque-haya-bibli |
        | sectionmark-no-se-confunde-con-un-inicio-de-seccion |
        | sin-metadata-de-pagina-no-inserta-el-comando-aunque-haya-tit |
        | un-blockquote-inicial-omite-el-vspace |
        | un-dictum-inicial-omite-el-vspace-y-no-aplica-noindent |
        | un-rawblock-chapter-cuenta-como-inicio-de-seccion-toc-y-sin- |

  Regla de negocio: latex/07-titlepages convierte los campos internos en páginas
    Los campos de frontmatter multilínea alimentan las páginas de título internas.
    Pandoc normaliza los espacios finales del YAML, así que el doble espacio que
    el autor escribe como salto de línea llega como `\\`.

    Esquema del escenario: Las páginas de título internas se serializan
      Dado el caso de páginas de título "<caso>"
      Cuando lo convierto con el filtro de páginas de título
      Entonces cumple las expectativas guardadas

      Ejemplos:
        | caso |
        | collectioncreator-acepta-array-como-author-no-revienta-y-se- |
        | convierte-el-colophon-multilinea-doble-espacio-y-vspace |
        | convierte-el-frontmatter-multilinea-doble-espacio-y-vspace |
        | convierte-el-subtitle-multilinea-doble-espacio-y-vspace |
        | dedication-con-div-dictum-multilinea-y-autor |
        | dedication-con-div-dictum-se-convierte-a-dictum-author-text |
        | dedication-con-raw-latex-dictum-se-serializa-sin-escapar |
        | publisherimage-pasa-la-ruta-literal-sin-escapar-el-guion-baj |
        | serializa-campos-simples-sin |
        | sin-campos-de-titulo-internas-nada-cambia |
        | startpaper-pasa-la-ruta-literal-sin-escapar-el-guion-bajo |
        | subject-con-array-de-un-solo-item-se-une-sin-coma-extra |
        | subject-y-publishers-aceptan-array-de-strings-como-author-se |
        | titleimage-pasa-la-ruta-literal-sin-escapar-el-guion-bajo |

    Escenario: El índice y la bibliografía salen solo cuando hay citas
      Dado un cuerpo con una cita a una clave de la bibliografía
      Cuando lo convierto con el filtro de flags y la bibliografía
      Entonces el .tex imprime la bibliografía
      Cuando lo convierto con el filtro de flags sin bibliografía
      Entonces el .tex no imprime la bibliografía

    Escenario: La bibliografía no se imprime sin citas aunque haya bibliografía
      Dado un cuerpo sin citas
      Cuando lo convierto con el filtro de flags y la bibliografía
      Entonces el .tex no imprime la bibliografía

    Escenario: El comando de página va después del primer título
      Dado un cuerpo que empieza con un título
      Cuando lo convierto con el filtro de flags y el comando de página
      Entonces el comando de página va después del encabezado

    Escenario: Con RawBlocks de sección fusionados el comando va tras el primero
      Dado un cuerpo con un part, un chapter y un section seguidos
      Cuando lo convierto con el filtro de flags y el comando de página
      Entonces el comando de página va entre el part y el section

    Escenario: En HTML el heading de referencias aparece solo con citas
      Dado un cuerpo con una cita a una clave de la bibliografía
      Cuando lo convierto a HTML con el filtro de flags y la bibliografía
      Entonces el HTML trae el heading de referencias
      Dado un cuerpo sin citas
      Cuando lo convierto a HTML con el filtro de flags y la bibliografía
      Entonces el HTML no trae el heading de referencias

    Escenario: En HTML el heading de referencias aparece aun con citas rotas
      Dado un cuerpo con una cita a una clave que no existe
      Cuando lo convierto a HTML con el filtro de flags y la bibliografía
      Entonces el HTML trae el heading de referencias
