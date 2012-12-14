
class TraceTree

  constructor : (@treeId, @color) ->
    @nodes = []

  removeNode : (id) ->
    for i in [0...@nodes.length]
      if @nodes[i].id == id
        @nodes.splice(i, 1)
        return