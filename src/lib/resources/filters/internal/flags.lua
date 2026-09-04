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

-- BlockQuote nativo o Div.dictum/verse/quote/cjk: abren entorno list.
local function is_list_opener(b)
  if b.t == 'BlockQuote' then return true end
  if b.t == 'Div' then
    for _, cls in ipairs(b.classes or {}) do
      if cls == 'dictum' or cls == 'verse' or cls == 'quote' or cls == 'japanese' or cls == 'chinese' or cls == 'korean' then return true end
    end
  end
  return false
end

-- Divide el texto de un RawBlock después del PRIMER comando de sección
-- (\part{Uno}\n\chapter{Dos} → "\part{Uno}", "\n\chapter{Dos}").
-- Los RawBlocks consecutivos se fusionan en pandoc, así que varios comandos
-- de sección escritos en líneas seguidas llegan como un solo bloque: el
-- comando de página debe ir entre el primero y el resto. Retorna nil como
-- segunda parte si no hay un segundo comando.
local function split_first_section_command(text)
  local cmd = text:match('^\\([%a]+)')
  if cmd == nil then return text, nil end
  local i = #cmd + 2 -- posición después de '\comando'
  if text:sub(i, i) == '*' then i = i + 1 end
  -- saltar espacios entre el comando y su argumento
  while text:sub(i, i) == ' ' or text:sub(i, i) == '\t' do i = i + 1 end
  local open = text:find('{', i)
  if open == nil then return text, nil end
  -- brace matching: el primer comando termina donde se cierra su brace
  local depth = 0
  for j = open, #text do
    local c = text:sub(j, j)
    if c == '{' then
      depth = depth + 1
    elseif c == '}' then
      depth = depth - 1
      if depth == 0 then
        local rest = text:sub(j + 1)
        if rest:find('\\[%a]') then
          return text:sub(1, j), rest
        end
        return text, nil
      end
    end
  end
  return text, nil
end

function Pandoc(doc)
  -- Detección estructural con recorrido COMPLETO del árbol (walk_block):
  -- las citas y los headings cuentan aunque estén dentro de un Div (p. ej.
  -- todo el contenido en ::: {.verse}): antes, los headings anidados no
  -- activaban has-toc-entries y el \\tableofcontents se omitía aunque pandoc
  -- los listaría en el TOC. El inicio de sección (primer bloque) se evalúa
  -- aparte, solo a nivel superior.
  local has_cites = false
  local has_toc_entries = false
  local detect = {
    Cite = function(c)
      has_cites = true
      return c
    end,
    Header = function(h)
      has_toc_entries = true
      return h
    end,
    RawBlock = function(b)
      if is_section_raw(b) then has_toc_entries = true end
      return b
    end,
  }
  local nb = {}
  for _, b in ipairs(doc.blocks) do
    -- walk_block no aplica los handlers al bloque raíz: los headers/RawBlock
    -- top-level se evalúan aquí; los anidados los detecta el walk.
    if is_header(b) or is_section_raw(b) then has_toc_entries = true end
    table.insert(nb, pandoc.walk_block(b, detect))
  end
  doc.blocks = nb

  if FORMAT == 'latex' then
    local first = doc.blocks[1]
    local section_start = first ~= nil and (is_header(first) or is_section_raw(first))
    local list_start = first ~= nil and is_list_opener(first)
    local skip = section_start or list_start

    -- \noindent al primer párrafo (mismo criterio que skipNoIndent)
    if not skip and first ~= nil and first.t == 'Para' then
      table.insert(first.content, 1, pandoc.RawInline('latex', '\\noindent '))
    end

    -- Numeración de páginas: el CLI pasa el comando configurado como metadata
    -- (page-number-command, string plano o MetaString). Si el primer bloque del
    -- body es un title o un list-opener (skip), la numeración se activa DESPUÉS
    -- de ese bloque (el template la omite): las páginas de la portada/TOC
    -- previas quedan sin número (layers vacíos) y la del contenido empieza
    -- numerada. Con un párrafo normal, el template la emite antes del body.
    local page_cmd = doc.meta['page-number-command']
    local page_cmd_text
    if type(page_cmd) == 'string' then
      page_cmd_text = page_cmd
    elseif type(page_cmd) == 'table' and page_cmd.text ~= nil then
      page_cmd_text = page_cmd.text
    end
    if page_cmd_text ~= nil and page_cmd_text ~= '' then
      -- El template interpola el comando como RawInline para que no lo re-escape.
      doc.meta['page-number-command'] = pandoc.MetaInlines({ pandoc.RawInline('latex', page_cmd_text) })
    end
    if skip and page_cmd_text ~= nil and page_cmd_text ~= '' then
      -- Un RawBlock inicial puede contener varios comandos de sección fusionados
      -- (\part{Uno}\n\chapter{Dos}\n\section{Tres} llegan como un solo bloque):
      -- el comando de página debe ir DESPUÉS del PRIMERO, no al final del bloque.
      if first.t == 'RawBlock' then
        local head, rest = split_first_section_command(first.text)
        if rest ~= nil then
          first.text = head
          table.insert(doc.blocks, 2, pandoc.RawBlock('latex', page_cmd_text))
          table.insert(doc.blocks, 3, pandoc.RawBlock('latex', rest))
        else
          table.insert(doc.blocks, 2, pandoc.RawBlock('latex', page_cmd_text))
        end
      else
        table.insert(doc.blocks, 2, pandoc.RawBlock('latex', page_cmd_text))
      end
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
