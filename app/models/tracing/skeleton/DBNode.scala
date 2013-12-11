package models.tracing.skeleton

import oxalis.nml.Node
import reactivemongo.bson.BSONObjectID
import models.basics.SecuredBaseDAO
import play.api.libs.json.Json
import play.modules.reactivemongo.json.BSONFormats._
import braingames.reactivemongo.DBAccessContext
import play.api.libs.concurrent.Execution.Implicits._

case class DBNode(node: Node, _treeId: BSONObjectID, _id: BSONObjectID = BSONObjectID.generate)

object DBNode {
  implicit val dbNodeFormat = Json.format[DBNode]
}

object DBNodeDAO extends SecuredBaseDAO[DBNode] {

  // TODO: ensure index!
  // c.collection.ensureIndex("_treeId")

  val collectionName = "nodes"

  val formatter = DBNode.dbNodeFormat

  def remove(nodeId: Int, _tree: BSONObjectID)(implicit ctx: DBAccessContext) =
    collectionRemove(Json.obj("_treeId" -> _tree, "node.id" -> nodeId))

  def findByTree(_tree: BSONObjectID)(implicit ctx: DBAccessContext) =
    find("_treeId", _tree).collect[List]()

  def findOneByTree(_tree: BSONObjectID)(implicit ctx: DBAccessContext) =
    collectionFind(Json.obj("_treeId" -> _tree)).one[DBNode]

  def countByTree(_tree: BSONObjectID)(implicit ctx: DBAccessContext) =
    count(Json.obj("_treeId" -> _tree))

  def removeAllOf(_tree: BSONObjectID)(implicit ctx: DBAccessContext) =
    remove("_treeId", _tree)

  def updateNode(node: Node, treeOid: BSONObjectID)(implicit ctx: DBAccessContext) =
    collectionUpdate(
      Json.obj("_treeId" -> treeOid, "node.id" -> node.id),
      Json.obj("$set" -> Json.obj(
        "node" -> Json.obj(
          "id" -> node.id,
          "radius" -> node.radius,
          "position" -> node.position,
          "viewport" -> node.viewport,
          "resolution" -> node.resolution,
          "timestamp" -> node.timestamp))), upsert = false, multi = false)

  def moveAllNodes(_source: BSONObjectID, _target: BSONObjectID)(implicit ctx: DBAccessContext) =
    collectionUpdate(
      Json.obj("_treeId" -> _source),
      Json.obj("$set" -> Json.obj(
        "_treeId" -> _target)), upsert = false, multi = true)

  def moveNodes(nodeIds: List[Int], _source: BSONObjectID, _target: BSONObjectID)(implicit ctx: DBAccessContext) =
    collectionUpdate(
      Json.obj("node.id" -> Json.obj("$in" -> nodeIds), "_treeId" -> _source),
      Json.obj("$set" -> Json.obj(
        "_treeId" -> _target)), upsert = false, multi = true)
}