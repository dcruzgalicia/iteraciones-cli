-- Convierte el span [texto]{.mbox} a \mbox{texto} (solo LaTeX: evita que
-- pandoc rompa el grupo de palabras entre lineas). En HTML el span conserva
-- la clase mbox para estilizacion CSS.
function Span(el)
  if FORMAT ~= 'latex' then return nil end
  if not el.classes:find('mbox', 1, true) then return nil end
  local body = pandoc.write(pandoc.Pandoc({ pandoc.Para(el.content) }), 'latex')
  body = body:gsub('%s+$', '')
  return pandoc.RawInline('latex', '\\mbox{' .. body .. '}')
end
