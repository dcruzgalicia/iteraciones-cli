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
