-- #2487 — los campos de la portada que LaTeX pasa por markdown (los mismos que
-- lista latex/07-titlepages.lua) llegan aquí como texto plano en --metadata: el
-- template los emite tal cual, así que un `collectionCreatorPrefix: *Edición*`
-- salía con los asteriscos en vez de en cursiva. Este filtro los vuelve a leer
-- como markdown y deja el resultado como inlines, que el template ya emite
-- formateado. Los que no son markdown (title, creator, date) no se tocan.
-- Uso: pandoc --from json --to html5 --lua-filter html/07-titlepage-meta.lua

local FIELDS = {
  'titlehead',
  'subject',
  'subtitle',
  'publishers',
  'collection-creator',
  'collection-creator-prefix',
}

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

-- Valor de metadata a inlines: si ya son inlines se deja; si es un bloque o una
-- lista se aplana; si es texto se lee como markdown.
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
  if kind == 'List' then
    -- subject, publishers y collectionCreator admiten lista: se unen con ', ',
    -- como hace el maketitle de LaTeX.
    local out = pandoc.Inlines({})
    for _, item in ipairs(value) do
      local inl = as_inlines(item)
      if inl ~= nil then
        if #out > 0 then
          out:insert(pandoc.Str(','))
          out:insert(pandoc.Space())
        end
        out:extend(inl)
      end
    end
    return out
  end
  if kind ~= 'string' then
    return nil
  end
  local text = pandoc.utils.stringify(value)
  if text:match('^%s*$') then
    return nil
  end
  return blocks_to_inlines(pandoc.read(text, 'markdown').blocks)
end

-- El metadata solo existe dentro del filtro, no al cargar el archivo.
function Pandoc(doc)
  for _, field in ipairs(FIELDS) do
    local inlines = as_inlines(doc.meta[field])
    if inlines ~= nil and #inlines > 0 then
      doc.meta[field] = inlines
    end
  end
  return doc
end
