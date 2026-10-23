import type { DiscoveryEntry } from './types.js';

export interface ListFilter {
  type?: string;
  creator?: string;
  date?: { from?: string; to?: string };
  keyword?: string;
  path?: string;
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

function normaliza(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

function contiene(texto: string, buscado: string): boolean {
  return normaliza(texto).includes(normaliza(buscado));
}

function keywordsDe(entry: DiscoveryEntry): string[] {
  const raw = entry.fm?.keywords;
  if (typeof raw === 'string') return [raw];
  if (Array.isArray(raw)) return raw.filter((k): k is string => typeof k === 'string');
  return [];
}

function fechaUtil(fecha: string | undefined): string | undefined {
  if (fecha === undefined) return undefined;
  const limpia = fecha.trim();
  return ISO_RE.test(limpia) ? limpia : undefined;
}

export function parseListFilter(fm: Record<string, unknown>): ListFilter {
  const raw = fm.filter;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const f = raw as Record<string, unknown>;
  const filtro: ListFilter = {};
  if (typeof f.type === 'string') filtro.type = f.type;
  if (typeof f.creator === 'string') filtro.creator = f.creator;
  if (typeof f.keyword === 'string') filtro.keyword = f.keyword;
  if (typeof f.path === 'string') filtro.path = f.path;
  if (typeof f.date === 'object' && f.date !== null && !Array.isArray(f.date)) {
    const bordes = f.date as Record<string, unknown>;
    const date: { from?: string; to?: string } = {};
    if (typeof bordes.from === 'string') date.from = bordes.from;
    if (typeof bordes.to === 'string') date.to = bordes.to;
    filtro.date = date;
  }
  return filtro;
}

function cumpleTipo(entry: DiscoveryEntry, filtro: ListFilter): boolean {
  if (filtro.type === undefined) return true;
  return (entry.type ?? 'file') === filtro.type;
}

function cumpleCreator(entry: DiscoveryEntry, filtro: ListFilter): boolean {
  if (filtro.creator === undefined) return true;
  return entry.creator.some((c) => contiene(c, filtro.creator as string));
}

function cumpleFecha(entry: DiscoveryEntry, filtro: ListFilter): boolean {
  if (filtro.date === undefined) return true;
  const fecha = fechaUtil(entry.date);
  if (fecha === undefined) return false;
  if (filtro.date.from !== undefined && fecha < filtro.date.from) return false;
  if (filtro.date.to !== undefined && fecha > filtro.date.to) return false;
  return true;
}

function cumpleKeyword(entry: DiscoveryEntry, filtro: ListFilter): boolean {
  if (filtro.keyword === undefined) return true;
  return keywordsDe(entry).some((k) => contiene(k, filtro.keyword as string));
}

function cumplePath(ruta: string, filtro: ListFilter): boolean {
  if (filtro.path === undefined) return true;
  return ruta.startsWith(filtro.path);
}

function cumple(ruta: string, entry: DiscoveryEntry, filtro: ListFilter): boolean {
  return (
    cumpleTipo(entry, filtro) &&
    cumpleCreator(entry, filtro) &&
    cumpleFecha(entry, filtro) &&
    cumpleKeyword(entry, filtro) &&
    cumplePath(ruta, filtro)
  );
}

function fechaOrdenable(entry: DiscoveryEntry): number {
  if (entry.date !== undefined) {
    const fecha = Date.parse(entry.date);
    if (!Number.isNaN(fecha)) return fecha;
  }
  return entry.mtime ?? 0;
}

function compararFecha(a: DiscoveryEntry, b: DiscoveryEntry, descendente: boolean): number {
  const diferencia = fechaOrdenable(a) - fechaOrdenable(b);
  if (diferencia === 0) return 0;
  return descendente ? -diferencia : diferencia;
}

function compararTexto(a: string, b: string): number {
  return a.localeCompare(b, 'es');
}

function primerCreator(entry: DiscoveryEntry): string {
  return entry.creator[0] ?? '';
}

function comparador(orden: string): (a: { ruta: string; entry: DiscoveryEntry }, b: { ruta: string; entry: DiscoveryEntry }) => number {
  const porRuta = (a: { ruta: string }, b: { ruta: string }): number => compararTexto(a.ruta, b.ruta);
  if (orden === 'date-asc') return (a, b) => compararFecha(a.entry, b.entry, false) || porRuta(a, b);
  if (orden === 'title-asc') return (a, b) => compararTexto(a.entry.title, b.entry.title) || porRuta(a, b);
  if (orden === 'title-desc') return (a, b) => -compararTexto(a.entry.title, b.entry.title) || porRuta(a, b);
  if (orden === 'creator-asc') return (a, b) => compararTexto(primerCreator(a.entry), primerCreator(b.entry)) || porRuta(a, b);
  return (a, b) => compararFecha(a.entry, b.entry, true) || porRuta(a, b);
}

export function listOrder(fm: Record<string, unknown>): string {
  const order = fm.order;
  return typeof order === 'string' ? order : 'date-desc';
}

/**
 * Los documentos que entran en una lista: todo el proyecto menos las
 * interventions (no tienen contenido que mostrar) y la lista misma, filtrado
 * por los criterios del frontmatter y ordenado.
 */
export function selectListMembers(relativePath: string, fm: Record<string, unknown>, discoveryIndex: Map<string, DiscoveryEntry>): string[] {
  const filtro = parseListFilter(fm);
  const elegidos: { ruta: string; entry: DiscoveryEntry }[] = [];
  for (const [ruta, entry] of discoveryIndex) {
    if (ruta === relativePath) continue;
    if (entry.type === 'intervention') continue;
    if (!cumple(ruta, entry, filtro)) continue;
    elegidos.push({ ruta, entry });
  }
  elegidos.sort(comparador(listOrder(fm)));
  return elegidos.map((e) => e.ruta);
}
