package models.tracing

import models.Color
import org.bson.types.ObjectId
import models.basics._
import models.context._
import com.mongodb.casbah.commons.MongoDBObject
import xml.Xml
import xml.XMLWrites
import play.api.libs.json.Format
import play.api.libs.json.Writes
import play.api.libs.json.Json
import nml.Tree
import nml.Node
import nml.Edge
import com.mongodb.casbah.commons.MongoDBList
import com.mongodb.casbah.query.Implicits._

case class DBTree(_tracing: ObjectId, treeId: Int, color: Color, _id: ObjectId = new ObjectId) extends DAOCaseClass[DBTree] {
  val dao = DBTree

  def nodes = DBTree.nodes.findByParentId(_id).toList
  def edges = DBTree.edges.findByParentId(_id).toList
}

trait DBTreeFactory {
  def createFrom(tracingId: ObjectId, t: Tree) = {
    DBTree(tracingId, t.treeId, t.color)
  }

  def createCopy(t: DBTree, tid: ObjectId) = {
    t.copy(_id = new ObjectId, _tracing = tid)
  }
}

object DBTree extends BasicDAO[DBTree]("trees") with DBTreeFactory {

  /*def createAndInsertDeepCopy(t: DBTree): DBTree = {
    createAndInsertDeepCopy(t, t._tracing, 0)
  }*/

  def createAndInsertDeepCopy(tree: DBTree, newTracing: ObjectId, nodeIdOffset: Int) = {
    val parent = createCopy(tree, newTracing)
    insert(parent).map { oid =>
      findNodesByTree(tree._id).map { n =>
        nodes.insert(n.copy(
          _treeId = oid,
          _id = new ObjectId,
          node = n.node.copy(id = n.node.id + nodeIdOffset)))
      }
      findEdgesByTree(tree._id).map { e =>
        edges.insert(e.copy(
          _treeId = oid,
          _id = new ObjectId,
          edge = e.edge.copy(source = e.edge.source + nodeIdOffset, target = e.edge.target + nodeIdOffset)))
      }
    }
    parent
  }

  def findNodesByTree(tid: ObjectId) = {
    nodes.find(MongoDBObject("_treeId" -> tid)).toList
  }
  def findEdgesByTree(tid: ObjectId) = {
    edges.find(MongoDBObject("_treeId" -> tid)).toList
  }

  def insertOne(tracingId: ObjectId, t: Tree): DBTree = {
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
    edges.remove(MongoDBObject("_treeId" -> treeOid, "edge.source" -> edge.source, "edge.target" -> edge.target))
  }

  def deleteEdgesOfNode(nodeId: Int, treeOid: ObjectId) = {
    edges.remove(MongoDBObject("_treeId" -> treeOid, "$or" -> MongoDBList(
      MongoDBObject("edge.source" -> nodeId),
      MongoDBObject("edge.target" -> nodeId))))
  }

  // TODO: remove code duplication -> NMLParser.createUniqueIds
  def createUniqueIds(trees: List[DBTree]) = {
    trees.foldLeft(List[DBTree]()) { (l, t) =>
      if (l.isEmpty || l.find(_.treeId == t.treeId).isEmpty)
        t :: l
      else {
        val alteredId = (l.maxBy(_.treeId).treeId + 1)
        t.copy(treeId = alteredId) :: l
      }
    }
  }

  def cloneAndAddTrees(sourceId: ObjectId, targetId: ObjectId) = {
    val targetMinId = minNodeId(findAllWithTracingId(targetId))
    val sourceMaxId = maxNodeId(findAllWithTracingId(sourceId))
    val nodeIdOffset = math.max(sourceMaxId + 1 - targetMinId, 0)

    findAllWithTracingId(sourceId)
      .map(tree => createAndInsertDeepCopy(tree, targetId, nodeIdOffset))
  }

  def maxNodeId(trees: List[DBTree]) = {
    lastNode(trees, false).map(_.node.id) getOrElse 0
  }

  def minNodeId(trees: List[DBTree]) = {
    lastNode(trees, true).map(_.node.id) getOrElse 0
  }

  def lastNode(trees: List[DBTree], desc: Boolean) = {
    nodes
      .find(MongoDBObject("_treeId" -> MongoDBObject("$in" -> MongoDBList(trees.map(t => t._id)))))
      .sort(MongoDBObject("node.id" -> (if (desc) -1 else 1)))
      .limit(1)
      .toList
      .headOption
  }

  /*def increaseNodeIds(tree: DBTree, inc: Int) = {
    nodes.update(MongoDBObject("_treeId" -> tree._id), MongoDBObject("$inc" -> MongoDBObject("node.id" -> inc)), false, true)
    edges.update(MongoDBObject("_treeId" -> tree._id), MongoDBObject("$inc" -> MongoDBObject("edge.source" -> inc, "edge.target" -> inc)), false, true)
  }*/

  def createEmptyTree(tracing: ObjectId) =
    insertOne(DBTree(tracing, 1, Color(1, 0, 0, 0)))

  def findAllWithTracingId(tracingId: ObjectId) =
    find(MongoDBObject("_tracing" -> tracingId)).toList

  def removeAllWithTracingId(tracingId: ObjectId) =
    remove(MongoDBObject("_tracing" -> tracingId))

  def findOneWithTreeId(tracingId: ObjectId, treeId: Int) =
    findOne(MongoDBObject("_tracing" -> tracingId, "treeId" -> treeId))

  val nodes = new ChildCollection[DBNode, ObjectId](collection = DB.connection("nodes"), parentIdField = "_treeId") {}
  val edges = new ChildCollection[DBEdge, ObjectId](collection = DB.connection("edges"), parentIdField = "_treeId") {}

  implicit object DBTreeXMLWrites extends XMLWrites[DBTree] {
    import DBNode.DBNodeXMLWrites
    import DBEdge.DBEdgeXMLWrites

    def writes(t: DBTree) =
      <thing id={ t.treeId.toString } color.r={ t.color.r.toString } color.g={ t.color.g.toString } color.b={ t.color.b.toString } color.a={ t.color.a.toString }>
        <nodes>
          { t.nodes.map(n => Xml.toXML(n)) }
        </nodes>
        <edges>
          { t.edges.map(e => Xml.toXML(e)) }
        </edges>
      </thing>
  }

  implicit object DBTreeFormat extends Writes[DBTree] {
    import DBNode.DBNodeWrites
    import DBEdge.DBEdgeWrites

    val ID = "id"
    val NODES = "nodes"
    val EDGES = "edges"
    val COLOR = "color"

    def writes(t: DBTree) = Json.obj(
      ID -> t.treeId,
      NODES -> t.nodes,
      EDGES -> t.edges,
      COLOR -> t.color)
  }
}