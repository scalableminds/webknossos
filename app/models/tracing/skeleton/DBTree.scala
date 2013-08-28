package models.tracing.skeleton

import braingames.image.Color
import org.bson.types.ObjectId
import models.basics._
import models.context._
import com.mongodb.casbah.commons.MongoDBObject
import oxalis.nml.Tree
import oxalis.nml.Node
import oxalis.nml.Edge
import com.mongodb.casbah.commons.MongoDBList
import com.mongodb.casbah.query.Implicits._
import oxalis.nml.TreeLike

case class DBTree(_tracing: ObjectId, treeId: Int, color: Color, timestamp: Long = System.currentTimeMillis, name: String = "", _id: ObjectId = new ObjectId) extends DAOCaseClass[DBTree]{
  val dao = DBTree

  def isEmpty = {
    DBTree.nodes.findByParentId(_id).isEmpty &&
      DBTree.edges.findByParentId(_id).isEmpty
  }

  def nodes = DBTree.nodes.findByParentId(_id).map(_.node).toSet
  def edges = DBTree.edges.findByParentId(_id).map(_.edge).toSet
  
  def numberOfNodes =
    DBTree.nodes.countByParentId(_id)

  def numberOfEdges =
    DBTree.edges.countByParentId(_id)
    
  def toTree = {
    Tree(treeId, nodes, edges, color, name)
  }
}

trait DBTreeFactory {
  def createFrom(tracingId: ObjectId, t: TreeLike) = {
    val name = 
      if(t.name == "")
        nameFromId(t.treeId)
      else
        t.name
    DBTree(tracingId, t.treeId, t.color, t.timestamp, name)
  }

  def createCopy(t: DBTree, tid: ObjectId) = {
    t.copy(_id = new ObjectId, _tracing = tid)
  }

  def nameFromId(treeId: Int) = "Tree%03d".format(treeId)
}

object DBTree extends BasicDAO[DBTree]("trees") with DBTreeFactory {

  this.collection.ensureIndex("_tracing")

  /*def createAndInsertDeepCopy(t: DBTree): DBTree = {
    createAndInsertDeepCopy(t, t._tracing, 0)
  }*/
  

  def findNodesByTree(tid: ObjectId) = {
    nodes.find(MongoDBObject("_treeId" -> tid)).toList
  }
  def findEdgesByTree(tid: ObjectId) = {
    edges.find(MongoDBObject("_treeId" -> tid)).toList
  }

  def insertOne(tracingId: ObjectId, t: TreeLike): DBTree = {
    val tree = insertOne(DBTree.createFrom(tracingId, t))
    t.nodes.map { n =>
      nodes.insert(DBNode(n, tree._id))
    }
    t.edges.map { e =>
      edges.insert(DBEdge(e, tree._id))
    }
    tree
  }

  def insertNode(node: Node, treeOid: ObjectId) = {
    nodes.insert(DBNode(node, treeOid))
  }

  def deleteNode(nodeId: Int, treeOid: ObjectId) = {
    nodes.remove(MongoDBObject("_treeId" -> treeOid, "node.id" -> nodeId))
  }

  def updateNode(node: Node, treeOid: ObjectId) = {
    nodes.update(MongoDBObject("_treeId" -> treeOid, "node.id" -> node.id), MongoDBObject("$set" -> MongoDBObject(
      "node" -> MongoDBObject(
        "id" -> node.id,
        "radius" -> node.radius,
        "position" -> node.position,
        "viewport" -> node.viewport,
        "resolution" -> node.resolution,
        "timestamp" -> node.timestamp))), false, false)
  }

  def moveTreeComponent(nodeIds: List[Int], sourceOid: ObjectId, targetOid: ObjectId) = {
    nodes.update(
      ("node.id" $in nodeIds) ++
        ("_treeId" -> sourceOid),
      MongoDBObject("$set" -> MongoDBObject(
        "_treeId" -> targetOid)), false, true)

    edges.update(
      ("edge.source" $in nodeIds) ++
        ("edge.target" $in nodeIds) ++
        ("_treeId" -> sourceOid),
      MongoDBObject("$set" -> MongoDBObject(
        "_treeId" -> targetOid)), false, true)

    edges.remove(
      MongoDBObject(
        "_treeId" -> sourceOid,
        "$or" -> MongoDBList(
          ("edge.source" $nin nodeIds) ++
            ("edge.target" $in nodeIds),
          ("edge.source" $in nodeIds) ++
            ("edge.target" $nin nodeIds))))
  }

  def moveAllNodes(sourceOid: ObjectId, targetOid: ObjectId) = {
    nodes.update(MongoDBObject("_treeId" -> sourceOid), MongoDBObject("$set" -> MongoDBObject(
      "_treeId" -> targetOid)), false, true)
  }

  def moveAllEdges(sourceOid: ObjectId, targetOid: ObjectId) = {
    edges.update(MongoDBObject("_treeId" -> sourceOid), MongoDBObject("$set" -> MongoDBObject(
      "_treeId" -> targetOid)), false, true)
  }

  def insertEdge(edge: Edge, treeOid: ObjectId) = {
    edges.insert(DBEdge(edge, treeOid))
  }

  def deleteEdge(edge: Edge, treeOid: ObjectId) = {
    edges.remove(MongoDBObject("_treeId" -> treeOid, "$or" -> MongoDBList(
      MongoDBObject("edge.source" -> edge.source, "edge.target" -> edge.target),
      MongoDBObject("edge.source" -> edge.target, "edge.targetcc" -> edge.source))))
  }

  def deleteEdgesOfNode(nodeId: Int, treeOid: ObjectId) = {
    edges.remove(MongoDBObject("_treeId" -> treeOid, "$or" -> MongoDBList(
      MongoDBObject("edge.source" -> nodeId),
      MongoDBObject("edge.target" -> nodeId))))
  }

  def createEmptyTree(tracing: ObjectId) =
    insertOne(DBTree(tracing, 1, Color(1, 0, 0, 0), System.currentTimeMillis(), nameFromId(1)))

  def findAllWithTracingId(tracingId: ObjectId) =
    find(MongoDBObject("_tracing" -> tracingId)).toList

  def removeAllWithTracingId(tracingId: ObjectId) = {
    // TODO: remove nodes / edges
    remove(MongoDBObject("_tracing" -> tracingId))
  }

  def findOneWithTreeId(tracingId: ObjectId, treeId: Int) =
    findOne(MongoDBObject("_tracing" -> tracingId, "treeId" -> treeId))

  val nodes = {
    val c = new ChildCollection[DBNode, ObjectId](collection = DB.connection("nodes"), parentIdField = "_treeId") {}
    c.collection.ensureIndex("_treeId")
    c
  }
  val edges = {
    val c = new ChildCollection[DBEdge, ObjectId](collection = DB.connection("edges"), parentIdField = "_treeId") {}
    c.collection.ensureIndex("_treeId")
    c
  }
}