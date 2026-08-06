-- Convierte Div.verse al entorno \begin{verse}...\end{verse} (formato LaTeX),
-- con \noindent al párrafo siguiente si es Para.
-- El espaciado vertical lo gestiona el entorno verse (preamble 22-verse.tex).
-- Uso: pandoc --from json --to latex --lua-filter latex/03-verse.lua

local function has_class(block, cls)
  if block.t ~= 'Div' then return false end
  for _, c in ipairs(block.classes) do
    if c == cls then return true end
  end
  return false
end

local function process_verse(div)
  local result = { pandoc.RawBlock('latex', '\\begin{verse}') }
  for _, b in ipairs(div.content) do
    table.insert(result, b)
  end
  table.insert(result, pandoc.RawBlock('latex', '\\end{verse}'))
  return result
end

function Pandoc(doc)
  local result = {}
  local last_was_verse = false
  for _, block in ipairs(doc.blocks) do
    if has_class(block, 'verse') then
      local expanded = process_verse(block)
      for _, b in ipairs(expanded) do table.insert(result, b) end
      last_was_verse = true
    elseif last_was_verse and block.t == 'Para' then
      table.insert(block.content, 1, pandoc.RawInline('latex', '\\noindent '))
      table.insert(result, block)
      last_was_verse = false
    else
      table.insert(result, block)
      last_was_verse = false
    end
  end
  doc.blocks = result
  return doc
end
