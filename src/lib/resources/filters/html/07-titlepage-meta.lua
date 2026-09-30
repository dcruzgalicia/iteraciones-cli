-- #2487 — los campos de la portada que LaTeX pasa por markdown (los mismos que
-- lista latex/07-titlepages.lua) llegan aquí como texto plano en --metadata: el
-- template los emite tal cual, así que un `collectionCreatorPrefix: *Edición*`
-- salía con los asteriscos en vez de en cursiva. Este filtro los vuelve a leer
-- como markdown y deja el resultado como inlines, que el template ya emite
-- formateado. Los que no son markdown (title, creator, date) no se tocan.
--
-- De los nombres de las creadoras hay un campo aparte (`author-names`,
-- `collection-creator-names`), que llega como lista porque se pasa un
-- --metadata por nombre. Cada uno va en un span `whitespace-nowrap` y se unen
-- con ', ': es el equivalente del \mbox de cada creator en LaTeX, para que la
-- línea se parta entre nombres y nunca dentro de uno.
-- Uso: pandoc --from json --to html5 --lua-filter html/07-titlepage-meta.lua

local FIELDS = {
  'titlehead',
  'subject',
  'subtitle',
  'publishers',
  'collection-creator-prefix',
}

local NAME_FIELDS = { 'author-names', 'collection-creator-names' }

-- Un bloque (el bloque YAML literal `|`) se aplana a sus inlines.
local function blocks_to_inlines(blocks)
  local out = pandoc.Inlines({})
  for _, block in ipairs(blocks) do
    if block.t == 'Para' then
      out:extend(block.content)
    end
  end
  return out
end

-- Texto a inlines, leyéndolo como markdown (lo que hace la portada del PDF).
local function markdown_inlines(text)
  if text == nil or text:match('^%s*$') then
    return nil
  end
  return blocks_to_inlines(pandoc.read(text, 'markdown').blocks)
end

-- Valor de metadata a inlines: si ya son inlines se deja; si es un bloque se
-- aplana; si es texto se lee como markdown.
local function as_inlines(value)
  if value == nil then
    return nil
  end
  local kind = pandoc.utils.type(value)
  if kind == 'Inlines' then
    return value
  end
  if kind == 'Blocks' then
    return blocks_to_inlines(value)
  end
  if kind == 'string' then
    return markdown_inlines(pandoc.utils.stringify(value))
  end
  return nil
end

local function separator(out)
  if #out > 0 then
    out:insert(pandoc.Str(','))
    out:insert(pandoc.Space())
  end
end

-- La lista de nombres de las creadoras: cada nombre, en su span nowrap.
local function names_inlines(value)
  if value == nil then
    return nil
  end
  local out = pandoc.Inlines({})
  if pandoc.utils.type(value) == 'List' then
    for _, item in ipairs(value) do
      local inl = as_inlines(item)
      if inl ~= nil and #inl > 0 then
        separator(out)
        out:insert(pandoc.Span(inl, pandoc.Attr('', { 'whitespace-nowrap' })))
      end
    end
  else
    local inl = as_inlines(value)
    if inl == nil or #inl == 0 then
      return nil
    end
    out:insert(pandoc.Span(inl, pandoc.Attr('', { 'whitespace-nowrap' })))
  end
  return #out > 0 and out or nil
end

-- El metadata solo existe dentro del filtro, no al cargar el archivo.
function Pandoc(doc)
  for _, field in ipairs(FIELDS) do
    local inlines = as_inlines(doc.meta[field])
    if inlines ~= nil and #inlines > 0 then
      doc.meta[field] = inlines
    end
  end
  for _, field in ipairs(NAME_FIELDS) do
    local inlines = names_inlines(doc.meta[field])
    if inlines ~= nil then
      doc.meta[field] = inlines
    end
  end
  return doc
end
