-- Convierte Div.flushright al entorno \begin{flushright}...\end{flushright} (formato LaTeX).
-- Reemplaza al transpiler TS latex/05-flushright (Fase 6).
-- Uso: pandoc --from json --to latex --lua-filter latex/05-flushright.lua

local function has_class(block, cls)
  if block.t ~= 'Div' then return false end
  for _, c in ipairs(block.classes) do
    if c == cls then return true end
  end
  return false
end

function Pandoc(doc)
  local blocks = {}
  for _, block in ipairs(doc.blocks) do
    if has_class(block, 'flushright') then
      table.insert(blocks, pandoc.RawBlock('latex', '\\begin{flushright}'))
      for _, b in ipairs(block.content) do
        table.insert(blocks, b)
      end
      table.insert(blocks, pandoc.RawBlock('latex', '\\end{flushright}'))
    else
      table.insert(blocks, block)
    end
  end
  doc.blocks = blocks
  return doc
end
