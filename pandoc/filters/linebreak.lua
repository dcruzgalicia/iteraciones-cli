-- Lua filter for pandoc
-- Replaces consecutive LineBreaks (backslash at end of line) with
-- paragraph breaks using a non-breaking space, exactly matching the
-- spacing produced by &nbsp; on a blank line.
--
-- When markdown uses backslash-newline on consecutive lines:
--   Linea 1\
--   \
--   Linea 3
--
-- Pandoc produces a single Para with two LineBreaks in a row. In
-- LaTeX this becomes \\ + \strut \\, creating 2\baselineskip instead
-- of the intended 1\baselineskip (the same spacing as &nbsp;).
--
-- This filter splits the Para at consecutive LineBreaks and inserts
-- a separate paragraph with a non-breaking space (\u{00A0} = ~ in
-- LaTeX), matching the exact output of &nbsp; on a blank line.

function Para(para)
  local content = para.content
  local result = {}
  local current = {}
  local i = 1

  while i <= #content do
    local item = content[i]

    if item.t == "LineBreak" then
      -- Check if followed by another LineBreak
      local next_idx = i + 1
      if next_idx <= #content and content[next_idx].t == "LineBreak" then
        -- Consecutive LineBreaks: end current para, insert a blank
        -- para (non-breaking space), skip ALL consecutive breaks
        if #current > 0 then
          table.insert(result, pandoc.Para(current))
          current = {}
        end
        -- Insert a blank paragraph matching &nbsp; behavior
        table.insert(result, pandoc.Para({pandoc.Str("\u{00A0}")}))
        -- Skip all consecutive LineBreaks
        while next_idx <= #content and content[next_idx].t == "LineBreak" do
          next_idx = next_idx + 1
        end
        i = next_idx
      else
        -- Single LineBreak: keep it inside the paragraph
        table.insert(current, item)
        i = i + 1
      end
    else
      table.insert(current, item)
      i = i + 1
    end
  end

  -- Last segment
  if #current > 0 then
    table.insert(result, pandoc.Para(current))
  end

  -- If nothing was split, return the original para
  if #result == 0 then
    return para
  end

  return result
end
