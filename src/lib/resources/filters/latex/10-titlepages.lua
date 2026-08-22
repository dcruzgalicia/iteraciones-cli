-- Convierte los campos de frontmatter multilinea (subtitle, extratitle,
-- frontispiece, titlehead, subject, dedication, uppertitleback,
-- lowertitleback, publishers, colophon) a LaTeX para la portada, las páginas
-- de título internas y el colofón final. subject y publishers aceptan un
-- array de strings (como author): se unen con ', '. Solo corre en la pasada
-- latex (en HTML los campos se ignoran o los serializa el compositor HTML
-- con \n → espacio). title-image (imagen de portada) no es contenido
-- markdown: la ruta pasa literal como RawInline latex.
--
-- El valor llega como MetaBlocks (frontmatter YAML |: los párrafos ya son
-- bloques markdown) o MetaInlines (string simple). Se serializa con
-- pandoc.write: el doble espacio al final de línea → \\, y un párrafo con
-- solo :: (o :;) → \vspace{\baselineskip} (+ \noindent). El resultado se
-- guarda como MetaInlines(RawInline('latex')): el template lo emite sin
-- re-escape.
-- Uso: pandoc --from markdown --to latex --lua-filter latex/10-titlepages.lua

local TITLE_PAGE_FIELDS = {
  'subtitle',
  'extratitle',
  'frontispiece',
  'titlehead',
  'subject',
  'dedication',
  'uppertitleback',
  'lowertitleback',
  'publishers',
  'colophon',
}

-- subject y publishers aceptan un solo valor o un array (como author): los
-- items se unen con ', '. Pandoc parsea cada item del array como markdown
-- (MetaInlines → lista de inlines) o lo deja como string (MetaString): se
-- aceptan ambos, extrayendo el texto de inlines Str/Space. Si algún item es
-- complejo (markdown con formato), se deja el valor original.
local LIST_JOIN_FIELDS = { subject = true, publishers = true }

local function append_inline_text(parts, inl)
  if inl.t == 'Str' then
    table.insert(parts, inl.text)
  elseif inl.t == 'Space' then
    table.insert(parts, ' ')
  else
    return false
  end
  return true
end

local function join_string_list(meta)
  local parts = {}
  for _, item in ipairs(meta) do
    if type(item) == 'string' then
      table.insert(parts, item)
    elseif type(item) == 'table' and #item > 0 then
      local item_parts = {}
      for _, inl in ipairs(item) do
        if not append_inline_text(item_parts, inl) then
          return nil
        end
      end
      table.insert(parts, table.concat(item_parts))
    else
      return nil
    end
  end
  return table.concat(parts, ', ')
end

local BLOCK_TYPES = {
  Para = true, Plain = true, Header = true, BlockQuote = true, Div = true,
  BulletList = true, OrderedList = true, CodeBlock = true, RawBlock = true,
  Figure = true,
}

-- true si el párrafo es exactamente '::' o ':;' (espacio vertical del
-- vocabulario semántico, escrito como línea sola en el frontmatter).
local function para_is_spacer(para)
  local parts = {}
  for _, inl in ipairs(para.content) do
    if inl.t == 'Str' then
      table.insert(parts, inl.text)
    elseif inl.t ~= 'Space' and inl.t ~= 'SoftBreak' then
      return false
    end
  end
  local joined = table.concat(parts)
  return joined == '::' or joined == ':;'
end

-- Convierte el valor de metadata a una lista de bloques: MetaBlocks
-- (frontmatter |) tal cual; MetaInlines (string simple) envuelto en Para.
-- Los elementos Image se convierten a RawInline(\includegraphics) para
-- que pandoc.write los serialize correctamente.
local function image_to_latex(el)
  local path = el.src
  local attrs = ''
  if el.attributes and el.attributes['width'] then
    attrs = '[width=' .. el.attributes['width'] .. ']'
  end
  return '\\includegraphics' .. attrs .. '{' .. path .. '}'
end

local function meta_to_blocks(meta)
  if type(meta) ~= 'table' or #meta == 0 then return nil end
  local blocks = {}
  if BLOCK_TYPES[meta[1].t] then
    for i = 1, #meta do blocks[i] = meta[i] end
  else
    local inlines = {}
    for i = 1, #meta do
      local el = meta[i]
      if el.t == 'Image' then
        inlines[i] = pandoc.RawInline('latex', image_to_latex(el))
      elseif el.t == 'Figure' and el.content and #el.content > 0 then
        -- Figure block (pandoc 3.10+): extraer Image del contenido
        local inner = el.content[1]
        if inner.t == 'Image' then
          inlines[i] = pandoc.RawInline('latex', image_to_latex(inner))
        else
          inlines[i] = el
        end
      else
        inlines[i] = el
      end
    end
    return { pandoc.Para(inlines) }
  end
  return blocks
end

-- Serializa los bloques a LaTeX: los párrafos "::" se convierten a RawBlock
-- antes de escribir (pandoc.write maneja los escapes, los LineBreak del
-- doble espacio y las comillas).
local function serialize_titleback(blocks)
  local out = {}
  for _, b in ipairs(blocks) do
    if b.t == 'Para' and para_is_spacer(b) then
      local marker = b.content[1].text
      local latex = '\\vspace{\\baselineskip}'
      if marker == ':;' then latex = latex .. '\\noindent' end
      table.insert(out, pandoc.RawBlock('latex', latex))
    else
      table.insert(out, b)
    end
  end
  local latex = pandoc.write(pandoc.Pandoc(out), 'latex')
  return latex:gsub('%s+$', '')
end

-- title-image y publishers-image NO son contenido markdown: son rutas de
-- archivo que deben llegar literal a \includegraphics. El writer de pandoc
-- escaparía el guion bajo (mi_imagen.jpg → mi\_imagen.jpg) y rompería la
-- búsqueda del archivo. Acepta MetaString (--metadata del CLI) o inlines
-- Str/Space (frontmatter).
local RAW_PATH_FIELDS = { 'title-image', 'publishers-image', 'endpapers' }

local function meta_to_rawpath(meta)
  if type(meta) == 'string' then
    return meta
  end
  if type(meta) ~= 'table' or #meta == 0 then
    return nil
  end
  local parts = {}
  for _, inl in ipairs(meta) do
    if inl.t == 'Str' then
      table.insert(parts, inl.text)
    elseif inl.t == 'Space' then
      table.insert(parts, ' ')
    else
      return nil
    end
  end
  return table.concat(parts)
end

function Pandoc(doc)
  if FORMAT ~= 'latex' then return doc end

  for _, field in ipairs(TITLE_PAGE_FIELDS) do
    local meta = doc.meta[field]
    if LIST_JOIN_FIELDS[field] and type(meta) == 'table' and #meta > 0 then
      local joined = join_string_list(meta)
      if joined ~= nil then
        meta = { pandoc.Str(joined) }
      end
    end
    local blocks = meta_to_blocks(meta)
    if blocks ~= nil then
      local latex = serialize_titleback(blocks)
      if latex:match('%S') then
        doc.meta[field] = pandoc.MetaInlines({ pandoc.RawInline('latex', latex) })
      end
    end
  end

  for _, field in ipairs(RAW_PATH_FIELDS) do
    local raw = meta_to_rawpath(doc.meta[field])
    if raw ~= nil and raw ~= '' then
      doc.meta[field] = pandoc.MetaInlines({ pandoc.RawInline('latex', raw) })
    end
  end

  return doc
end
