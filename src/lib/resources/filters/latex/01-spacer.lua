-- Convierte Div.spacer en \vspace{\baselineskip} (formato LaTeX).
-- Si el Div tiene la clase noindent (caso :;), agrega \noindent al primer
-- párrafo siguiente (solo si es Para, igual que el filter TS).
-- Reemplaza al filter TS latex/01-spacer (Fase 6).
-- Uso: pandoc --from json --to latex --lua-filter latex/01-spacer.lua

local function has_class(block, cls)
  if block.t ~= 'Div' then return false end
  for _, c in ipairs(block.classes) do
    if c == cls then return true end
  end
  return false
end

function Pandoc(doc)
  local blocks = {}
  local pending_noindent = false
  for _, block in ipairs(doc.blocks) do
    if has_class(block, 'spacer') then
      table.insert(blocks, pandoc.RawBlock('latex', '\\vspace{\\baselineskip}'))
      pending_noindent = has_class(block, 'noindent')
    elseif pending_noindent and block.t == 'Para' then
      table.insert(block.content, 1, pandoc.RawInline('latex', '\\noindent '))
      table.insert(blocks, block)
      pending_noindent = false
    else
      table.insert(blocks, block)
      pending_noindent = false
    end
  end
  doc.blocks = blocks
  return doc
end
