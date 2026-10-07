# language: es
Característica: una copia de la salida que vuelve a construir

  Como quien manda el PDF a otra máquina
  Quiero que la carpeta de salida se sostenga sola
  Para que quien la reciba pueda compilar sin preguntarme nada

  Regla de negocio: Bundle está apagado salvo que se pida

    Escenario: Sin decirlo, bundle está apagado
      Dado que la raíz del proyecto está vacía
      Y un proyecto con bundle "false"
      Cuando bundle queda "false"
      Entonces bundle queda "false"

    Escenario: Pedirlo lo enciende
      Dado que la raíz del proyecto está vacía
      Y un proyecto con bundle "true"
      Cuando bundle queda "true"
      Entonces bundle queda "true"

  Regla de negocio: La salida lleva su propia copia de los insumos

    Escenario: Se replican config, preámbulo, filtros y bibliografía
      Dado que la raíz del proyecto está vacía
      Y un proyecto con los cuatro insumos
      Cuando construyo el proyecto con bundle
      Entonces la salida tiene una réplica de cada insumo
      Y el script de build repite el comando de bundle

    Escenario: El manifiesto vive en la caché, no en la salida
      Dado que la raíz del proyecto está vacía
      Y un proyecto con los cuatro insumos
      Cuando construyo el proyecto con bundle
      Entonces el manifiesto está en la caché del proyecto
      Y el manifiesto NO está en la salida

  Regla de negocio: Apagar bundle retira lo copiado y nada más

    Escenario: La siguiente corrida limpia lo replicado
      Dado que la raíz del proyecto está vacía
      Y un proyecto con los cuatro insumos
      Cuando construyo el proyecto con bundle
      Entonces el archivo "dist/files/iteraciones.config.yaml" existe en el proyecto
      Y el proyecto apaga bundle
      Cuando construyo el proyecto con bundle
      Y la salida NO tiene una réplica de cada insumo
      Y el manifiesto ya no está en la caché
      Y las salidas siguen en pie

    Escenario: Una copia de la salida reconstruye el mismo markdown
      Dado que la raíz del proyecto está vacía
      Y un proyecto con los cuatro insumos
      Cuando construyo el proyecto con bundle
      Entonces una copia de la salida
      Cuando construyo la copia desde cero
      Y la copia reconstruye el mismo markdown
      Y la copia también tiene su propia réplica

  Regla de negocio: El `.tex` de la salida no lleva rutas absolutas

    Escenario: El QR se copia a los assets del nivel y el .tex apunta ahí
      Dado que la raíz del proyecto está vacía
      Y un proyecto con los cuatro insumos
      Y el proyecto tiene un QR en el ensayo
      Cuando construyo el proyecto con bundle
      Entonces el .tex apunta al QR con una ruta relativa de assets
      Y el .tex no lleva ninguna ruta absoluta

  Regla de negocio: Relativizar es cuenta de niveles, no reemplazo a ciegas

    Esquema del escenario: La raíz del proyecto se cuenta hacia arriba
      Cuando relativizo "<ruta>" para la salida "<destino>"
      Entonces queda "<esperado>"

      Ejemplos:
        | ruta | destino | esperado |
        | \includegraphics{/proy/.iteraciones/processed-images/qr-abc.jpg} | la salida | \includegraphics{../../.iteraciones/processed-images/qr-abc.jpg} |
        | \includegraphics{/proy/.iteraciones/processed-images/qr-abc.jpg} | un nivel más | \includegraphics{../../../.iteraciones/processed-images/qr-abc.jpg} |
        | \includegraphics{/proy/.iteraciones/processed-images/qr-abc.jpg} | la raíz del proyecto | \includegraphics{/proy/.iteraciones/processed-images/qr-abc.jpg} |
        | x=/otra/raiz/y | la salida | x=/otra/raiz/y |

  Regla de negocio: Con bundle la bibliografía ya está, así que no se copia

    Escenario: La bibliografía apunta a la réplica y no se copia
      Dado que la raíz del proyecto está vacía
      Y un proyecto con la bibliografía
      Cuando localizo los assets con bundle "bibliografia"
      Entonces el .tex usa "\addbibresource{bibliografia.bib}"
      Y no se copia nada

    Escenario: Cualquier otra ruta del proyecto sólo se relativiza
      Dado que la raíz del proyecto está vacía
      Y un proyecto con un preámbulo propio
      Cuando localizo los assets con bundle "preambulo"
      Entonces el .tex usa "\input{../../preamble/04-margins.tex}"
      Y no se copia nada