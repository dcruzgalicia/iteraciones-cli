import type { TemplateContext } from '../../template/render/context.js';
import { escapeHtml } from '../html.js';
import type { BuildDocument } from '../types.js';

interface NavItem {
  label: string;
  link?: string;
  nav?: Array<{ label: string; link?: string }>;
}

/**
 * Normaliza un elemento de `nav` del frontmatter.
 * Devuelve `null` si el item no tiene `label` válido.
 */
function normalizeNavItem(raw: unknown): NavItem | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const label = typeof obj.label === 'string' ? obj.label.trim() : '';
  if (!label) return null;

  const item: NavItem = { label };

  if (typeof obj.link === 'string' && obj.link.trim()) {
    item.link = obj.link.trim();
  }

  if (Array.isArray(obj.nav)) {
    const nested = obj.nav.flatMap((child) => {
      const n = normalizeNavItem(child);
      if (!n) return [];
      // Los subitems de segundo nivel no tienen nav anidado en MVP
      return [{ label: n.label, ...(n.link && { link: n.link }) }];
    });
    if (nested.length > 0) item.nav = nested;
  }

  return item;
}

/**
 * Construye el TemplateContext para un documento de tipo `menu`.
 *
 * Variables producidas para `templates/menu.html`:
 *   title      → frontmatter.title
 *   pagetitle  → frontmatter.title
 *   body       → htmlFragment del documento (descripción opcional)
 *   menu-items → array de { label, link?, nav? } desde frontmatter.nav
 *   count      → número de items de primer nivel
 */
export function buildMenuContext(doc: BuildDocument): TemplateContext {
  const raw = doc.frontmatter.nav;
  const menuItems = Array.isArray(raw)
    ? raw.flatMap((item) => {
        const n = normalizeNavItem(item);
        return n ? [n] : [];
      })
    : [];

  return {
    title: doc.frontmatter.title,
    pagetitle: escapeHtml(doc.frontmatter.title),
    body: doc.htmlFragment ?? '',
    'menu-items': menuItems,
    count: menuItems.length,
  };
}
