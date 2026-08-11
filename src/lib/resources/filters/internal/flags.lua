-- Filtro interno de detección estructural (no es un filter de usuario).
-- Lo inyecta el pipeline en las pasadas latex y html; reemplaza la
-- inspección del AST que antes hacía TypeScript (computePreambleFlags,
-- hasCiteNodes, withReferencesHeading) sin pasadas adicionales de pandoc.
--
-- latex: calcula los flags del preámbulo y los expone al template vía
--   metadata ($if(has-toc-entries)$, $if(skip-paragraph-space)$);
--   antepone \noindent al primer párrafo; agrega \printbibliography
--   al final si hay citas y bibliografía.
-- html5: agrega el heading sintético de referencias (necesario para
--   link-citations) y expone has-references para el template.

local SECTION_COMMANDS = {
  subsubsection = true,
  subsection = true,
  section = true,
  subparagraph = true,
  paragraph = true,
  chapter = true,
  part = true,
}

local function is_header(b)
  return b.t == 'Header'
end

-- RawBlock LaTeX con un comando de sección (\chapter{...}, \section*{...}, ...)
-- escrito directamente en markdown: tipográficamente inicia una sección.
local function is_section_raw(b)
  if b.t ~= 'RawBlock' then return false end
  local fmt, text
  if b.c ~= nil then
    fmt, text = b.c[1], b.c[2]
  else
    -- RawBlock creado por un filtro (pandoc.RawBlock) expone format/text
    fmt, text = b.format, b.text
  end
  if (fmt ~= 'tex' and fmt ~= 'latex') or type(text) ~= 'string' then return false end
  local cmd = text:match('^\\([%a]+)')
  if cmd == nil or not SECTION_COMMANDS[cmd] then return false end
  local rest = text:sub(#cmd + 2)
  if rest:sub(1, 1) == '*' then rest = rest:sub(2) end
  if #rest == 0 then return true end
  local c = rest:sub(1, 1)
  return c == '[' or c == '{' or c == ' ' or c == '\t'
end

-- BlockQuote nativo o Div.dictum/verse/quote: abren entorno list.
local function is_list_opener(b)
  if b.t == 'BlockQuote' then return true end
  if b.t == 'Div' then
    for _, cls in ipairs(b.classes or {}) do
      if cls == 'dictum' or cls == 'verse' or cls == 'quote' then return true end
    end
  end
  return false
end

function Pandoc(doc)
  -- Detección de citas (nodos Cite reales, sin regex sobre el markdown)
  local has_cites = false
  local detect = { Cite = function(c) has_cites = true return c end }
  local nb = {}
  for _, b in ipairs(doc.blocks) do
    table.insert(nb, pandoc.walk_block(b, detect))
  end
  doc.blocks = nb

  if FORMAT == 'latex' then
    local first = doc.blocks[1]
    local section_start = first ~= nil and (is_header(first) or is_section_raw(first))
    local list_start = first ~= nil and is_list_opener(first)
    local has_toc_entries = false
    for _, b in ipairs(doc.blocks) do
      if is_header(b) or is_section_raw(b) then
        has_toc_entries = true
        break
      end
    end
    local skip = section_start or list_start

    -- \noindent al primer párrafo (mismo criterio que skipNoIndent)
    if not skip and first ~= nil and first.t == 'Para' then
      table.insert(first.content, 1, pandoc.RawInline('latex', '\\noindent '))
    end

    doc.meta['has-toc-entries'] = pandoc.MetaBool(has_toc_entries)
    doc.meta['skip-paragraph-space'] = pandoc.MetaBool(skip)

    if has_cites and doc.meta.bibliography ~= nil and doc.meta['biblatex-available'] ~= false then
      table.insert(doc.blocks, pandoc.RawBlock('latex', '\\printbibliography[heading=bibintoc]'))
    end
  elseif FORMAT == 'html5' then
    -- Heading sintético que citeproc necesita para enlazar las citas
    -- (link-citations); el post-procesamiento lo convierte en tarjeta.
    -- El id es sintético (refs-heading) para no colisionar con un heading
    -- "Referencias" propio del documento (id referencias): antes, el
    -- post-procesamiento borraba o duplicaba el del usuario.
    if has_cites and doc.meta.bibliography ~= nil then
      table.insert(doc.blocks, pandoc.Header(1, pandoc.Str('Referencias'), pandoc.Attr('refs-heading', {}, {})))
      doc.meta['has-references'] = pandoc.MetaBool(true)
    end
  end
  return doc
end
