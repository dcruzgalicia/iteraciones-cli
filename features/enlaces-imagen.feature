# language: es
Característica: nombre accesible de los enlaces de imagen

  Para que Lighthouse no marque enlaces sin nombre
  Quiero que la imagen enlazada tenga una etiqueta distinta al título

  Escenario: La tarjeta con imagen enlazada tiene nombre accesible
    Cuando genero una tarjeta de colección con imagen
    Entonces el enlace de la imagen dice "Imagen de Documento"
    Y la imagen sigue con alt vacío
