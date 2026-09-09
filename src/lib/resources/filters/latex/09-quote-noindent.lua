-- Inserta \noindent al primer párrafo normal que sigue a un BlockQuote
-- (blockquote de markdown, convertido al entorno quote en LaTeX).
-- El comportamiento es el mismo que dictum (02) y verse (03): tras un
-- entorno list, el párrafo siguiente no debe sangrarse.
-- Uso: pandoc --from json --to latex --lua-filter latex/08-quote-noindent.lua

function Pandoc(doc)
  local result = {}
  local last_was_quote = false
  for _, block in ipairs(doc.blocks) do
    if block.t == 'BlockQuote' then
      table.insert(result, block)
      last_was_quote = true
    elseif last_was_quote and block.t == 'Para' then
      table.insert(block.content, 1, pandoc.RawInline('latex', '\\noindent '))
      table.insert(result, block)
      last_was_quote = false
    else
      table.insert(result, block)
      last_was_quote = false
    end
  end
  doc.blocks = result
  return doc
end
