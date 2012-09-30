TYPE_USUAL  = 0
TYPE_BRANCH = 1

# This class should represent a Trace Point
class TracePoint

  constructor : (parent, type, id, pos, size, color) ->
    @parent   = parent
    @type     = type
    @id       = id
    @pos      = pos
    @size     = size
    @color    = color
    @children = []

  appendNext : (next) ->
    @children.push(next)

  findNodeById : (id) ->
    if (@children.length > 0)
      for c in @children
        if c.id == id then return c
      for c in @children
        cResult = c.findNodeById(id)
        if cResult then return cResult
    return null

  remove : (id) ->
    for i in [0..@children.length]
      if @children[i].id == id
        # Remove child
        @children.splice(i, i + 1)
        return

  getChildren : ->
    return @children

  toString : ->
    if (@type == TYPE_USUAL)
      if (@children[0])
        return @id + ", " + @children[0].toString()
      return @id + "."
    if (@type == TYPE_BRANCH)
      result = @id + "( "
      if (@children.length > 0)
        result += "(" + @children[0].toString() + ")"
      for c in @children[1..]
        result += ", (" + c.toString() + ")"
      result += " )"
      return result