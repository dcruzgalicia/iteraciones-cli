function Div(div)
  local is_center = false
  for _, c in ipairs(div.classes) do
    if c == 'center' then
      is_center = true
      break
    end
  end
  if not is_center then return nil end
  local result = { pandoc.RawBlock('html', '<div class="center">') }
  for _, block in ipairs(div.content) do
    table.insert(result, block)
  end
  table.insert(result, pandoc.RawBlock('html', '</div>'))
  return result
end
