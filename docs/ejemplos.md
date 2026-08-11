# Ejemplos de Markdown — iteraciones-cli

Documento de ejemplo que muestra todos los elementos soportados. El comando `iteraciones init` genera un index.md reducido; este archivo es la referencia completa.

## Encabezados

# Título de nivel 1 (h1)

## Título de nivel 2 (h2)

### Título de nivel 3 (h3)

#### Título de nivel 4 (h4)

##### Título de nivel 5 (h5)

###### Título de nivel 6 (h6)

## Listas

- Elemento de lista no ordenada
- Otro elemento
- Un tercer elemento

1. Elemento de lista ordenada
2. Segundo elemento
3. Tercer elemento

## Citas

> Esto es una cita en bloque. Puede contener múltiples párrafos.
>
> — Autor de la cita

## Código

Un fragmento de código en línea: `console.log("Hola mundo");`.

```
// Bloque de código
function saludar(nombre) {
  return `Hola, ${nombre}!`;
}
```

## Énfasis

*Texto en cursiva* y **texto en negritas**.

También se puede usar _cursiva_ y __negritas__ con guiones bajos.

## Espacio vertical extra (::)

Para forzar un espacio vertical extra entre párrafos, usa una línea que contenga únicamente dos puntos dobles: `::`:

```
Texto del primer párrafo.

::

Texto del segundo párrafo con espacio vertical extra.
```

## Epígrafe (dictum)

Para incluir un epígrafe o cita destacada, usa un fenced div con la clase `.dictum`. Opcionalmente puedes añadir un autor con un fenced div anidado con clase `.author`.

::: {.dictum}
Dios hizo los números enteros, el resto es obra del hombre.
:::

::: {.dictum}
La ciencia se compone de errores, que a su vez son los pasos
hacia la verdad.

::: {.author}
Julio Verne
:::
:::

## Poemas (verse)

Para escribir poemas, usa un fenced div con la clase `.verse`.

::: {.verse}
Rosa de fuego,
luminosa y efímera,
florece en el aire.
:::

## Texto en japonés, chino o coreano (CJK)

Para escribir texto CJK en el PDF (japonés, chino simplificado o coreano), rodea el párrafo con un fenced div de idioma. En HTML el texto se muestra directamente (UTF-8 nativo); en el PDF se activa el entorno CJKutf8.

::: {.japanese}
花見は春の風物詩です。
:::

::: {.chinese}
这是中文。
:::

::: {.korean}
한국어입니다.
:::

## Citas y referencias

Puedes usar citas con pandoc citekeys. Por ejemplo:

Según @ejemplo2024, el uso de citekeys facilita la gestión de referencias.

También puedes usar citas entre corchetes: [@ejemplo2024, p. 42].

Las referencias se generan automáticamente al final del documento.
