package models.tracing

import models.Color
import org.bson.types.ObjectId
import models.basics._
import models.graph._
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

case class DBTree(treeId: Int, color: Color, _id: ObjectId = new ObjectId) extends DAOCaseClass[DBTree] {
  val dao = DBTree

  def nodes = DBTree.nodes.findByParentId(_id).toList
  def edges = DBTree.edges.findByParentId(_id).toList
}

trait DBTreeFactory {
  def createFrom(t: Tree) = {
    DBTree(t.treeId, t.color)
  }
}

object DBTree extends BasicDAO[DBTree]("trees") with DBTreeFactory {

  def deepCopy(t: DBTree) = {
    val parent = t.copy(_id = new ObjectId)
    insert(parent).map { oid =>
      nodes.findByParentId(t._id).map { n =>
        nodes.insert(n.copy(_treeId = oid, _id = new ObjectId))
      }
      edges.findByParentId(t._id).map { e =>
        edges.insert(e.copy(_treeId = oid, _id = new ObjectId))
      }

    }
    parent
  }

  def insertOne(t: Tree): DBTree = {
    val tree = insertOne(DBTree.createFrom(t))
    t.nodes.map { n =>
      println("inserting NODE")
      println(nodes.insert(DBNode.createFrom(n, tree._id)))
    }
    t.edges.map { e =>
      println("inserting EDGE")
      edges.insert(DBEdge.createFrom(e, tree._id))
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

  def moveNode(nodeId: Int, sourceOid: ObjectId, targetOid: ObjectId) = {
    nodes.update(MongoDBObject("_treeId" -> sourceOid, "node.id" -> nodeId), MongoDBObject("$set" -> MongoDBObject(
      "_treeId" -> targetOid)))
  }
  
  def moveAllNodes(sourceOid: ObjectId, targetOid: ObjectId) = {
    nodes.update(MongoDBObject("_treeId" -> sourceOid), MongoDBObject("$set" -> MongoDBObject(
      "_treeId" -> targetOid)))
  }

  def moveAllEdges(sourceOid: ObjectId, targetOid: ObjectId) = {
    edges.update(MongoDBObject("_treeId" -> sourceOid), MongoDBObject("$set" -> MongoDBObject(
      "_treeId" -> targetOid)))
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

  def createEmptyTree = {
    insertOne(DBTree(1, Color(1, 0, 0, 0)))
  }

  def findOneWithTreeId(ts: List[ObjectId], treeId: Int) = {
    findOne(MongoDBObject("_id" -> MongoDBObject("$in" -> ts), "treeId" -> treeId))
  }

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