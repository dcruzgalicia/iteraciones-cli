function Span(el)
  if FORMAT ~= 'latex' then return nil end
  if not el.classes:find('mbox', 1, true) then return nil end
  local body = pandoc.write(pandoc.Pandoc({ pandoc.Para(el.content) }), 'latex')
  body = body:gsub('%s+$', '')
  return pandoc.RawInline('latex', '\\mbox{' .. body .. '}')
end
