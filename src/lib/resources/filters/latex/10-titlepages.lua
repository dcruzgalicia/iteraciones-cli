-- Convierte los campos de frontmatter multilinea (extratitle, dedication,
-- uppertitleback, lowertitleback) a LaTeX para las páginas de título
-- internas. Solo corre en la pasada latex (en HTML los campos se ignoran).
--
-- El valor llega como MetaBlocks (frontmatter YAML |: los párrafos ya son
-- bloques markdown) o MetaInlines (string simple). Se serializa con
-- pandoc.write: el doble espacio al final de línea → \\, y un párrafo con
-- solo :: (o :;) → \vspace{\baselineskip} (+ \noindent). El resultado se
-- guarda como MetaInlines(RawInline('latex')): el template lo emite sin
-- re-escape.
-- Uso: pandoc --from markdown --to latex --lua-filter latex/10-titlepages.lua

local TITLEBACK_FIELDS = { 'extratitle', 'dedication', 'uppertitleback', 'lowertitleback' }

local BLOCK_TYPES = {
  Para = true, Plain = true, Header = true, BlockQuote = true, Div = true,
  BulletList = true, OrderedList = true, CodeBlock = true, RawBlock = true,
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
local function meta_to_blocks(meta)
  if type(meta) ~= 'table' or #meta == 0 then return nil end
  local blocks = {}
  if BLOCK_TYPES[meta[1].t] then
    for i = 1, #meta do blocks[i] = meta[i] end
  else
    local inlines = {}
    for i = 1, #meta do inlines[i] = meta[i] end
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

function Pandoc(doc)
  if FORMAT ~= 'latex' then return doc end

  for _, field in ipairs(TITLEBACK_FIELDS) do
    local blocks = meta_to_blocks(doc.meta[field])
    if blocks ~= nil then
      local latex = serialize_titleback(blocks)
      if latex:match('%S') then
        doc.meta[field] = pandoc.MetaInlines({ pandoc.RawInline('latex', latex) })
      end
    end
  end

  return doc
end
