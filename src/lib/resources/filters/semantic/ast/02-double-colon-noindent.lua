-- Convierte párrafos con solo ":;" en Div.spacer noindent (semántico).
-- Solo transforma párrafos de nivel superior (no dentro de otros bloques).
-- Uso: pandoc --from markdown --to json --lua-filter semantic/ast/02-double-colon-noindent.lua

function Pandoc(doc)
  local blocks = {}
  for _, block in ipairs(doc.blocks) do
    if block.t == 'Para' and #block.content == 1 then
      local inl = block.content[1]
      if inl.t == 'Str' and inl.text == ':;' then
        table.insert(blocks, pandoc.Div(pandoc.Blocks{}, pandoc.Attr('', { 'spacer', 'noindent' })))
      else
        table.insert(blocks, block)
      end
    else
      table.insert(blocks, block)
    end
  end
  doc.blocks = blocks
  return doc
end
