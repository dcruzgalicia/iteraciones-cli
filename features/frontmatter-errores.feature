# language: es
Característica: markdown y merge dicen qué está mal en el frontmatter

  Como quien escribe y corrigió el mismo archivo cuatro veces porque el error no decía nada
  Quiero que merge y markdown digan la causa en español y con su posición
  Para arreglarlo sin abrir el archivo a ojo

  Regla de negocio: El mensaje lleva la causa y dónde está

    Escenario: merge con frontmatter mal formado
      Dado que un documento con frontmatter mal formado
      Cuando fusiono el documento mal formado
      Entonces el comando termina con el código de salida 1
      Y el error dice que los items del mapeo deben empezar en la misma columna
      Y el error no dice nada en inglés

    Escenario: markdown con frontmatter mal formado
      Dado que un documento con frontmatter mal formado
      Cuando convierto el documento mal formado a markdown
      Entonces el comando termina con el código de salida 1
      Y el error dice que los items del mapeo deben empezar en la misma columna
      Y el error no dice nada en inglés