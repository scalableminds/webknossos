app             = require("app")
Backbone        = require("backbone")
ErrorHandling   = require("libs/error_handling")
Model           = require("../model")
Dimensions      = require("../model/dimensions")
constants       = require("../constants")
Tree            = require("./tree")

class Skeleton

  # This class is supposed to collect all the Geometries that belong to the skeleton, like
  # nodes, edges and trees

  COLOR_ACTIVE : 0xff0000

  constructor : (@model) ->

    _.extend(this, Backbone.Events)

    @skeletonTracing    = @model.skeletonTracing
    @treeGeometries = []
    @isVisible      = true

    @showInactiveTrees = true

    @reset()

    @listenTo(@skeletonTracing, "newActiveNode", (nodeId) ->
      @setActiveNode()
      @setInactiveTreeVisibility(@showInactiveTrees)
    )
    @listenTo(@skeletonTracing, "newActiveNodeRadius", @setActiveNodeRadius)
    @listenTo(@skeletonTracing, "newTree", (treeId, treeColor) ->
      @createNewTree(treeId, treeColor)
      @setInactiveTreeVisibility(@showInactiveTrees)
    )
    @listenTo(@skeletonTracing, "deleteTree", @deleteTree)
    @listenTo(@skeletonTracing, "deleteActiveNode", @deleteNode)
    @listenTo(@skeletonTracing, "mergeTree", @mergeTree)
    @listenTo(@skeletonTracing, "newNode", @setWaypoint)
    @listenTo(@skeletonTracing, "setBranch", @setBranch)
    @listenTo(@skeletonTracing, "newTreeColor", @updateTreeColor)
    @listenTo(@skeletonTracing, "reloadTrees", @loadSkeletonFromModel)

    @listenTo(@model.user, "particleSizeChanged", @setParticleSize)
    @listenTo(@model.user, "overrideNodeRadiusChanged", (overrideNodeRadius) =>
      for tree in @treeGeometries
        tree.showRadius(not @model.user.get("overrideNodeRadius"))
    )

  createNewTree : (treeId, treeColor) ->

    @treeGeometries.push( tree = new Tree(treeId, treeColor, @model) )
    @setActiveNode()
    @trigger("newGeometries", tree.getMeshes())


  # Will completely reload the trees from model.
  # This needs to be done at initialization

  reset : ->

    for tree in @treeGeometries
      @trigger("removeGeometries", tree.getMeshes())
      tree.dispose()

    @treeGeometries = []

    for tree in @skeletonTracing.getTrees()
      @createNewTree(tree.treeId, tree.color)

    @loadSkeletonFromModel()


  loadSkeletonFromModel : (trees) ->

    unless trees? then trees = @model.skeletonTracing.getTrees()

    for tree in trees

      treeGeometry = @getTreeGeometry(tree.treeId)
      treeGeometry.clear()
      treeGeometry.addNodes( tree.nodes )

      for branchpoint in tree.branchpoints
        treeGeometry.updateNodeColor(branchpoint.id, null, true)

    @setActiveNode()

    app.vent.trigger("rerender")


  setBranch : (isBranchPoint, node) ->

    treeGeometry = @getTreeGeometry( node.treeId )
    treeGeometry.updateNodeColor(node.id, null, isBranchPoint)

    app.vent.trigger("rerender")


  updateTreeColor : (treeId) ->

    @getTreeGeometry(treeId).updateTreeColor()
    app.vent.trigger("rerender")


  getMeshes : =>

    meshes = []
    for tree in @treeGeometries
      meshes = meshes.concat(tree.getMeshes())
    return meshes

  setWaypoint : (centered) =>

    treeGeometry = @getTreeGeometry(@skeletonTracing.getTree().treeId)

    treeGeometry.addNode(@skeletonTracing.getActiveNode())
    app.vent.trigger("rerender")


  deleteNode : (node, treeId) ->

    ErrorHandling.assertEquals(node.neighbors.length, 1, "Node needs to have exactly 1 neighbor.")

    treeGeometry = @getTreeGeometry(treeId)
    treeGeometry.deleteNode(node)

    app.vent.trigger("rerender")


  mergeTree : (lastTreeID, lastNode, activeNode) ->

    lastTree   = @getTreeGeometry(lastTreeID)
    activeTree = @getTreeGeometry(@skeletonTracing.getTree().treeId)

    activeTree.mergeTree(lastTree, lastNode, activeNode)


  deleteTree : (index) ->

    treeGeometry = @treeGeometries[index]

    @trigger("removeGeometries", treeGeometry.getMeshes())
    treeGeometry.dispose()
    @treeGeometries.splice(index, 1)

    app.vent.trigger("rerender")


  setActiveNode : ->

    if @lastActiveNode?
      treeGeometry = @getTreeGeometry(@lastActiveNode.treeId)
      treeGeometry?.updateNodeColor(@lastActiveNode.id, false)

    if (activeNode = @model.skeletonTracing.getActiveNode())?
      treeGeometry = @getTreeGeometry(activeNode.treeId)
      treeGeometry?.updateNodeColor(activeNode.id, true)
      treeGeometry?.startNodeHighlightAnimation(activeNode.id)

    @lastActiveNode = activeNode


  setActiveNodeRadius : ->

    if (activeNode = @model.skeletonTracing.getActiveNode())?
      treeGeometry = @getTreeGeometry( activeNode.treeId )
      treeGeometry?.updateNodeRadius( activeNode.id, activeNode.radius )
      app.vent.trigger("rerender")


  getAllNodes : ->

    return (tree.nodes for tree in @treeGeometries)


  getTreeGeometry : (treeId) ->

    unless treeId
      treeId = @skeletonTracing.getTree().treeId
    for tree in @treeGeometries
      if tree.id == treeId
        return tree
    return null


  setVisibilityTemporary : (isVisible) ->

    for mesh in @getMeshes()
      mesh.visible = isVisible && (if mesh.isVisible? then mesh.isVisible else true)
    app.vent.trigger("rerender")


  setVisibility : (@isVisible) ->

    app.vent.trigger("rerender")


  restoreVisibility : ->

    @setVisibilityTemporary( @isVisible )


  toggleVisibility : ->

    @setVisibility( not @isVisible )


  updateForCam : (id) ->

    for tree in @treeGeometries
      tree.showRadius( id != constants.TDView and
        not @model.user.get("overrideNodeRadius") )

    if id in constants.ALL_PLANES
      @setVisibilityTemporary( @isVisible )
    else
      @setVisibilityTemporary( true )


  toggleInactiveTreeVisibility : ->

    @showInactiveTrees = not @showInactiveTrees
    @setInactiveTreeVisibility(@showInactiveTrees)


  setInactiveTreeVisibility : (visible) ->

    for mesh in @getMeshes()
      mesh.isVisible = visible
    treeGeometry = @getTreeGeometry(@skeletonTracing.getTree().treeId)
    treeGeometry.edges.isVisible = true
    treeGeometry.nodes.isVisible = true
    app.vent.trigger("rerender")


  setSizeAttenuation : (sizeAttenuation) ->

    for tree in @treeGeometries
      tree.setSizeAttenuation(sizeAttenuation)

module.exports = Skeleton
