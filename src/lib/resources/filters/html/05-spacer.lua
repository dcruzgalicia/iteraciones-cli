function Div(div)
  local is_spacer = false
  for _, c in ipairs(div.classes) do
    if c == 'spacer' then
      is_spacer = true
      break
    end
  end
  if not is_spacer then return nil end
  return pandoc.RawBlock('html', '<div class="h-[1.5em]"></div>')
end
