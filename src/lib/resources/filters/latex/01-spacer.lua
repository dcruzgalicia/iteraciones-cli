local function has_class(block, cls)
  if block.t ~= 'Div' then return false end
  for _, c in ipairs(block.classes) do
    if c == cls then return true end
  end
  return false
end

function Div(div)
  if not has_class(div, 'spacer') or has_class(div, 'noindent') then return nil end
  return pandoc.RawBlock('latex', '\\vspace{\\baselineskip}')
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
