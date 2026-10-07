function Header(el)
  if el.level == 3 then
    local text = pandoc.write(pandoc.Pandoc({el}), 'html')
    local content = text:match('>(.-)<') or ''
    return pandoc.RawBlock('html',
      '<div class="font-bold italic">' .. content .. '</div>')
  end
end
