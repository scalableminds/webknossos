StateLogger    = require("../statelogger")
THREE          = require("three")
{V3}           = require("libs/mjs")
ErrorHandling  = require("libs/error_handling")

class SkeletonTracingStateLogger extends StateLogger


  constructor : (flycam, @flycam3d, version, tracingId, tracingType, allowUpdate, @skeletonTracing) ->

    super(flycam, version, tracingId, tracingType, allowUpdate)


  #### TREES

  treeObject : (tree, oldId) ->

    treeColor = new THREE.Color(tree.color)
    return {
      id : if oldId then oldId else tree.treeId
      updatedId : if oldId then tree.treeId
      color : [treeColor.r, treeColor.g, treeColor.b, 1]
      name : tree.name
      timestamp : tree.timestamp
      comments : tree.comments
      branchPoints : tree.branchpoints
    }


  createTree : (tree) ->

    @pushDiff("createTree", @treeObject(tree))


  updateTree : (tree, oldId = false) ->

    @pushDiff("updateTree", @treeObject(tree, oldId))


  deleteTree : (tree) ->

    @pushDiff("deleteTree", {
      id : tree.treeId
    })


  mergeTree : (sourceTree, targetTree, lastNodeId, activeNodeId) ->

    # Make sure that those nodes exist
    found = false; treeIds = []
    for node in sourceTree.nodes
      found |= (node.id == lastNodeId)
      treeIds.push(node.id)
    ErrorHandling.assert(found, "lastNodeId not in sourceTree",
      {sourceTreeNodeIds : treeIds, lastNodeId : lastNodeId})

    found = false; treeIds = []
    for node in targetTree.nodes
      found |= (node.id == activeNodeId)
      treeIds.push(node.id)
    ErrorHandling.assert(found, "activeNodeId not in targetTree",
      {targetTreeNodeIds : treeIds, activeNodeId : activeNodeId})

    # Copy all edges and nodes from sourceTree to
    # targetTree, while leaving targetTree's properties
    # unchanged. Then, delete sourceTree.
    @pushDiff("mergeTree", {
      sourceId : sourceTree.treeId
      targetId : targetTree.treeId
    }, false)
    @createEdge(lastNodeId, activeNodeId, targetTree.treeId)


  #### NODES and EDGED

  nodeObject : (node, treeId) ->

    return _.extend(node.metaInfo,
      treeId : treeId,
      id : node.id,
      radius : node.radius,
      position : V3.floor(node.pos),
      rotation : node.rotation
    )


  edgeObject : (node, treeId) ->

    ErrorHandling.assert(node.neighbors.length == 1,
      "Node has to have exactly one neighbor", node.neighbors.length)

    return {
      treeId : treeId
      source : node.neighbors[0].id
      target : node.id
    }


  createNode : (node, treeId) ->

    ErrorHandling.assert(node.neighbors.length <= 1,
      "New node can't have more than one neighbor", node.neighbors.length)
    if node.neighbors[0]
      ErrorHandling.assert(node.treeId == node.neighbors[0].treeId,
        "Neighbor has different treeId",
        {treeId1 : node.treeId, treeId2 : node.neighbors[0].treeId})

    needsEdge = node.neighbors.length == 1
    @pushDiff("createNode", @nodeObject(node, treeId), !needsEdge)
    if needsEdge
      @pushDiff("createEdge", @edgeObject(node, treeId))


  updateNode : (node, treeId) ->

    @pushDiff("updateNode", @nodeObject(node, treeId))


  deleteNode : (node, treeId) ->

    # Edges will be deleted implicitly
    @pushDiff("deleteNode", {
      treeId : treeId
      id : node.id
    })


  moveTreeComponent : (sourceId, targetId, nodeIds) ->

    @pushDiff("moveTreeComponent", {
      sourceId : sourceId
      targetId : targetId
      nodeIds : nodeIds
    })


  createEdge : (source, target, treeId) ->

    # used when edges are set manually, e.g. for merging trees
    @pushDiff("createEdge", {
      treeId : treeId
      source : source
      target : target
    })


  concatUpdateTracing : ->

    @pushDiff(
      "updateTracing"
      {
        activeNode : @skeletonTracing.getActiveNodeId()
        editPosition : V3.floor(@flycam.getPosition())
        editRotation : @flycam3d.getRotation()
        zoomLevel : @flycam.getZoomStep()
      }
      false
    )
    ErrorHandling.assert(@newDiffs.length > 0, "newDiffs empty after concatUpdateTracing", {
      @newDiffs
    })


module.exports = SkeletonTracingStateLogger
