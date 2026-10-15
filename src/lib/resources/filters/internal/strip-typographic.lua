-- Quita las construcciones exclusivas de la pasada LaTeX/PDF cuando se escribe markdown:
-- shrink, stretch, runt y text-nowrap. Solo quita el contenedor, conserva el contenido.
function Div(el)
  if el.attributes and (el.attributes['shrink'] ~= nil or el.attributes['stretch'] ~= nil or el.attributes['runt'] ~= nil) then
    return el.content
  end
  return nil
end

function Span(el)
  if el.classes and el.classes:find('text-nowrap', 1, true) then
    return el.content
  end
  return nil
end