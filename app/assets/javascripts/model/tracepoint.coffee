KIND_USUAL  = 0
KIND_BRANCH = 1

# This class should represent a Trace Point
class TracePoint

  constructor : (parent, kind, id, pos, size, color) ->
    @parent   = parent
    @kind     = kind
    @id       = id
    @pos      = pos
    @size     = size
    @color    = color
    @children = []

  appendNext : (next) ->
    if (@kind == KIND_USUAL)
      @next = next
    if (@kind == KIND_BRANCH)
      @children.push(next)

  toString : ->
    if (@kind == KIND_USUAL)
      if (@next)
        return @id + ", " + @next.toString()
      return @id + "."
    if (@kind == KIND_BRANCH)
      result = @id + "( "
      if (@children.length > 0)
        result += "(" + @children[0].toString() + ")"
      for c in @children[1..]
        result += ", (" + c.toString() + ")"
      result += " )"
      return result