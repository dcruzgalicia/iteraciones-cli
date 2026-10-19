import { After, type DataTable, Given, Then, When } from '@cucumber/cucumber';
import {
  envuelveParrafoContenedor,
  esTituloDeSeccion,
  normalizaParaBusqueda,
  type ObjetivoTypography,
  objetivosParaIncidencia,
  remplazaEspacioAnterior,
  remplazaEspacioPosterior,
  tienePalabraSuelta,
  yaAplicado,
} from '../../cli/typography.js';
import type { SingleWordLine, TypographyIncidence } from '../../lib/pdf-typography.js';
import { raiz } from './cli-world.steps.js';

type Estado = {
  resultado: string | undefined;
  normalizado: string;
  bandera: boolean;
  incidencia: TypographyIncidence | undefined;
  segunda: TypographyIncidence | undefined;
};

const vacio = (): Estado => ({
  resultado: undefined,
  normalizado: '',
  bandera: false,
  incidencia: undefined,
  segunda: undefined,
});

const estado: Estado = vacio();

After(() => {
  Object.assign(estado, vacio());
});

function conSalto(texto: string): string {
  return texto.endsWith('\n') ? texto : `${texto}\n`;
}

function compara(actual: string | undefined, esperado: string): void {
  if (actual === undefined) throw new Error(`no hubo resultado; se esperaba:\n${esperado}`);
  if (actual.trimEnd() !== esperado.trimEnd()) {
    throw new Error(`quedó:\n${actual}\ny debía quedar:\n${esperado}`);
  }
}

function incidenciaSimple(texto: string, extra: Partial<SingleWordLine> = {}): TypographyIncidence {
  return { type: 'single-word-line', page: 1, line: 1, text: texto, ...extra };
}

const TIPOS = ['single-word-line', 'consecutive-punctuation', 'repeated-first-letter', 'repeated-last-letter'] as const;

type Tipo = (typeof TIPOS)[number];

function esTipo(valor: string): valor is Tipo {
  return (TIPOS as readonly string[]).includes(valor);
}

function incidenciaDeTabla(tipo: string, pagina: number, linea: number, letra: string | undefined, tabla: DataTable): TypographyIncidence {
  if (!esTipo(tipo)) throw new Error(`tipo de incidencia desconocido: ${JSON.stringify(tipo)}`);
  const lineas = tabla.hashes().map((fila) => ({ line: Number(fila.linea), text: fila.texto ?? '' }));
  const comun = { page: pagina, line: linea, text: (lineas[0]?.text ?? '').trim() };
  if (tipo === 'single-word-line') return { type: tipo, ...comun };
  if (tipo === 'consecutive-punctuation') return { type: tipo, ...comun, lineas, total: lineas.length };
  return { type: tipo, ...comun, letter: letra ?? '', lineas, total: lineas.length };
}

function objetivosDe(incidencia: TypographyIncidence | undefined): ObjetivoTypography[] {
  if (incidencia === undefined) throw new Error('no hay incidencia en el escenario');
  return objetivosParaIncidencia(incidencia);
}

function buscaObjetivo(sufijo: string): ObjetivoTypography {
  const encontrado = objetivosDe(estado.incidencia).find((objetivo) => objetivo.aguja.endsWith(sufijo));
  if (encontrado === undefined) throw new Error(`ningún objetivo termina en ${JSON.stringify(sufijo)}`);
  return encontrado;
}

function buscaObjetivoPosterior(sufijo: string): ObjetivoTypography {
  const encontrado = objetivosDe(estado.incidencia).find((objetivo) => objetivo.posterior && objetivo.aguja.endsWith(sufijo));
  if (encontrado === undefined) throw new Error(`ningún objetivo posterior termina en ${JSON.stringify(sufijo)}`);
  return encontrado;
}

function aplica(objetivo: ObjetivoTypography | undefined, md: string): string | undefined {
  if (objetivo === undefined) return undefined;
  return objetivo.posterior ? remplazaEspacioPosterior(md, objetivo.aguja) : remplazaEspacioAnterior(md, objetivo.aguja);
}

When('normalizo para buscar {string}', (contenido: string) => {
  estado.normalizado = normalizaParaBusqueda(contenido);
});

Then('el texto normalizado es {string}', (esperado: string) => {
  if (estado.normalizado !== esperado) {
    throw new Error(`el texto normalizado es ${JSON.stringify(estado.normalizado)} y debía ser ${JSON.stringify(esperado)}`);
  }
});

When('envuelvo el párrafo contenedor de la incidencia {string}:', (texto: string, contenido: string) => {
  estado.resultado = envuelveParrafoContenedor(conSalto(contenido), incidenciaSimple(texto));
});

When('envuelvo el párrafo contenedor de la incidencia {string} seguida de {string}:', (texto: string, siguiente: string, contenido: string) => {
  estado.resultado = envuelveParrafoContenedor(conSalto(contenido), incidenciaSimple(texto, { next: siguiente }));
});

When('vuelvo a envolver el párrafo contenedor de la incidencia {string}', (texto: string) => {
  estado.resultado = estado.resultado === undefined ? undefined : envuelveParrafoContenedor(estado.resultado, incidenciaSimple(texto));
});

Then('el markdown queda:', (esperado: string) => {
  compara(estado.resultado, esperado);
});

Then('no hay párrafo que envolver', () => {
  if (estado.resultado !== undefined) throw new Error(`sí hubo párrafo que envolver:\n${estado.resultado}`);
});

When('busco la palabra suelta {string} en:', (palabra: string, contenido: string) => {
  estado.bandera = tienePalabraSuelta(conSalto(contenido), palabra);
});

Then('encuentra la palabra suelta', () => {
  if (!estado.bandera) throw new Error('no encontró la palabra suelta');
});

Then('no encuentra la palabra suelta', () => {
  if (estado.bandera) throw new Error('encontró la palabra suelta y no debía');
});

When('reviso si es título de sección la incidencia {string} en:', (texto: string, contenido: string) => {
  estado.bandera = esTituloDeSeccion(conSalto(contenido), incidenciaSimple(texto));
});

Then('es título de sección', () => {
  if (!estado.bandera) throw new Error('no es título de sección');
});

Then('no es título de sección', () => {
  if (estado.bandera) throw new Error('es título de sección y no debía');
});

When('pego el espacio posterior de {string} en:', (aguja: string, contenido: string) => {
  estado.resultado = remplazaEspacioPosterior(conSalto(contenido), aguja);
});

When('pego el espacio anterior de {string} en:', (aguja: string, contenido: string) => {
  estado.resultado = remplazaEspacioAnterior(conSalto(contenido), aguja);
});

Then('no hay dónde pegarlo', () => {
  if (estado.resultado !== undefined) throw new Error(`sí hubo dónde pegarlo:\n${estado.resultado}`);
});

When('reviso si la aguja {string} ya está aplicada por detrás en:', (aguja: string, contenido: string) => {
  estado.bandera = yaAplicado(conSalto(contenido), aguja, true);
});

When('reviso si la aguja {string} ya está aplicada por delante en:', (aguja: string, contenido: string) => {
  estado.bandera = yaAplicado(conSalto(contenido), aguja, false);
});

Then('ya está aplicada', () => {
  if (!estado.bandera) throw new Error('no estaba aplicada');
});

Then('no está aplicada', () => {
  if (estado.bandera) throw new Error('estaba aplicada y no debía');
});

Given(
  'una incidencia {string} de la página {int} y la línea {int} con estas líneas:',
  (tipo: string, pagina: number, linea: number, tabla: DataTable) => {
    estado.incidencia = incidenciaDeTabla(tipo, pagina, linea, undefined, tabla);
  },
);

Given(
  'una incidencia {string} de la página {int} y la línea {int} con la letra {string} y estas líneas:',
  (tipo: string, pagina: number, linea: number, letra: string, tabla: DataTable) => {
    estado.incidencia = incidenciaDeTabla(tipo, pagina, linea, letra, tabla);
  },
);

Given(
  'una segunda incidencia {string} de la página {int} y la línea {int} con la letra {string} y estas líneas:',
  (tipo: string, pagina: number, linea: number, letra: string, tabla: DataTable) => {
    estado.segunda = incidenciaDeTabla(tipo, pagina, linea, letra, tabla);
  },
);

Given('la incidencia tiene la continuación {string}', (continuacion: string) => {
  const incidencia = estado.incidencia;
  if (incidencia === undefined || incidencia.type === 'single-word-line') throw new Error('la incidencia no admite continuación');
  estado.incidencia = { ...incidencia, continuacion };
});

When('aplico el primer objetivo al markdown:', (contenido: string) => {
  estado.resultado = aplica(objetivosDe(estado.incidencia)[0], conSalto(contenido));
});

When('aplico el objetivo que termina en {string} al markdown:', (sufijo: string, contenido: string) => {
  estado.resultado = aplica(buscaObjetivo(sufijo), conSalto(contenido));
});

When('aplico el objetivo posterior que termina en {string} al markdown:', (sufijo: string, contenido: string) => {
  estado.resultado = aplica(buscaObjetivoPosterior(sufijo), conSalto(contenido));
});

Then('el primer objetivo es {string}', (aguja: string) => {
  const primero = objetivosDe(estado.incidencia)[0];
  if (primero?.aguja !== aguja) {
    throw new Error(`el primer objetivo es ${JSON.stringify(primero?.aguja)} y debía ser ${JSON.stringify(aguja)}`);
  }
});

Then('el primer objetivo termina en {string}', (sufijo: string) => {
  const primero = objetivosDe(estado.incidencia)[0];
  if (!primero?.aguja.endsWith(sufijo)) {
    throw new Error(`el primer objetivo es ${JSON.stringify(primero?.aguja)} y debía terminar en ${JSON.stringify(sufijo)}`);
  }
});

Then('el primer objetivo es posterior', () => {
  const primero = objetivosDe(estado.incidencia)[0];
  if (primero?.posterior !== true) throw new Error(`el primer objetivo no es posterior: ${JSON.stringify(primero)}`);
});

Then('el objetivo que termina en {string} es {string}', (sufijo: string, aguja: string) => {
  const objetivo = buscaObjetivo(sufijo);
  if (objetivo.aguja !== aguja) {
    throw new Error(`el objetivo es ${JSON.stringify(objetivo.aguja)} y debía ser ${JSON.stringify(aguja)}`);
  }
});

Then('el objetivo posterior que termina en {string} es {string}', (sufijo: string, aguja: string) => {
  const objetivo = buscaObjetivoPosterior(sufijo);
  if (objetivo.aguja !== aguja) {
    throw new Error(`el objetivo posterior es ${JSON.stringify(objetivo.aguja)} y debía ser ${JSON.stringify(aguja)}`);
  }
});

Then('el objetivo que termina en {string} es posterior', (sufijo: string) => {
  const objetivo = buscaObjetivo(sufijo);
  if (objetivo.posterior !== true) throw new Error(`el objetivo no es posterior: ${JSON.stringify(objetivo)}`);
});

Then('el objetivo {string} no es el primero', (aguja: string) => {
  const indice = objetivosDe(estado.incidencia).findIndex((objetivo) => objetivo.aguja === aguja);
  if (indice <= 0) throw new Error(`el objetivo ${JSON.stringify(aguja)} está en el índice ${indice} y debía ir después del primero`);
});

Then('ningún objetivo es {string}', (aguja: string) => {
  if (objetivosDe(estado.incidencia).some((objetivo) => objetivo.aguja === aguja)) {
    throw new Error(`sí hay un objetivo ${JSON.stringify(aguja)}`);
  }
});

Then('los objetivos de las dos incidencias coinciden', () => {
  const unicos = JSON.stringify(objetivosDe(estado.incidencia));
  const otros = JSON.stringify(objetivosDe(estado.segunda));
  if (unicos !== otros) throw new Error(`los objetivos no coinciden:\n${unicos}\n${otros}`);
});

Then('el objetivo que termina en {string} ya está aplicado por detrás en:', (sufijo: string, contenido: string) => {
  const objetivo = buscaObjetivo(sufijo);
  if (!yaAplicado(conSalto(contenido), objetivo.aguja, true)) {
    throw new Error(`no estaba aplicado: ${JSON.stringify(objetivo.aguja)}`);
  }
});

Then('el objetivo que termina en {string} no está aplicado por detrás en:', (sufijo: string, contenido: string) => {
  const objetivo = buscaObjetivo(sufijo);
  if (yaAplicado(conSalto(contenido), objetivo.aguja, true)) {
    throw new Error(`estaba aplicado y no debía: ${JSON.stringify(objetivo.aguja)}`);
  }
});

Given('que la raíz del proyecto es un repositorio git', async () => {
  await Bun.$`git init --quiet ${raiz()}`.quiet();
});
