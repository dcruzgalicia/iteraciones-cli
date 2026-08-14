-- Convierte el span [texto]{.uppercase} a \MakeUppercase{texto} (solo LaTeX:
-- el writer de pandoc ignora la clase y la deja como {texto}). En HTML el
-- span conserva la clase uppercase y Tailwind la estiliza (text-transform).
function Span(el)
  if FORMAT ~= 'latex' then return nil end
  if not el.classes:find('uppercase', 1, true) then return nil end
  local body = pandoc.write(pandoc.Pandoc({ pandoc.Para(el.content) }), 'latex')
  body = body:gsub('%s+$', '')
  return pandoc.RawInline('latex', '\\MakeUppercase{' .. body .. '}')
end
