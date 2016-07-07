package models.tracing.skeleton

import oxalis.nml.Edge
import reactivemongo.api.commands.WriteResult
import reactivemongo.bson.BSONObjectID
import play.api.libs.json.Json
import models.basics.SecuredBaseDAO
import com.scalableminds.util.reactivemongo.DBAccessContext
import scala.concurrent.Future
import reactivemongo.play.json.BSONFormats._
import play.api.libs.concurrent.Execution.Implicits._
import reactivemongo.api.indexes.{IndexType, Index}
import reactivemongo.core.commands.LastError
import com.scalableminds.util.tools.Fox

case class DBEdge(edge: Edge, _treeId: BSONObjectID, _id: BSONObjectID = BSONObjectID.generate)

object DBEdge {
  implicit val dbEdgeFormat = Json.format[DBEdge]
}

object DBEdgeDAO extends SecuredBaseDAO[DBEdge] {

  val collectionName = "edges"

  val formatter = DBEdge.dbEdgeFormat

  underlying.indexesManager.ensure(Index(Seq("_treeId" -> IndexType.Ascending)))

  def remove(edge: Edge, _tree: BSONObjectID)(implicit ctx: DBAccessContext): Fox[WriteResult] =
    remove(Json.obj("_treeId" -> _tree, "edge.source" -> edge.source, "edge.target" -> edge.target))

  def findByTree(_tree: BSONObjectID)(implicit ctx: DBAccessContext) = withExceptionCatcher{
    find(Json.obj("_treeId" -> _tree)).cursor[DBEdge]().collect[List]()
  }

  def findOneByTree(_tree: BSONObjectID)(implicit ctx: DBAccessContext) = withExceptionCatcher{
    find(Json.obj("_treeId"-> _tree)).one[DBEdge]
  }

  def countByTree(_tree: BSONObjectID)(implicit ctx: DBAccessContext) =
    count(Json.obj("_treeId"-> _tree))

  def removeAllOf(_tree: BSONObjectID)(implicit ctx: DBAccessContext) =
    remove("_treeId", _tree)

  def removeAllOnBorder(nodeIds: List[Int], _source: BSONObjectID)(implicit ctx: DBAccessContext) =
    remove(
      Json.obj(
        "_treeId" -> _source,
        "$or" -> Json.arr(
          Json.obj("edge.source" -> Json.obj("$nin" -> nodeIds),
            "edge.target" -> Json.obj("$in" -> nodeIds)),
          Json.obj("edge.source" -> Json.obj("$in" -> nodeIds),
            "edge.target" -> Json.obj("$nin" -> nodeIds)))))

  def moveAllEdges(_source: BSONObjectID, _target: BSONObjectID)(implicit ctx: DBAccessContext) =
    update(
      Json.obj("_treeId" -> _source),
      Json.obj("$set" -> Json.obj(
        "_treeId" -> _target)), upsert = false, multi = true)

  def moveEdges(nodeIds: List[Int], _source: BSONObjectID, _target: BSONObjectID)(implicit ctx: DBAccessContext) =
    update(
      Json.obj(
        "edge.source" -> Json.obj("$in" -> nodeIds),
        "edge.target" -> Json.obj("$in" -> nodeIds),
        "_treeId" -> _source),
      Json.obj("$set" -> Json.obj(
        "_treeId" -> _target)), upsert = false, multi = true)

  def deleteEdge(edge: Edge, _tree: BSONObjectID)(implicit ctx: DBAccessContext) = {
    remove(
      Json.obj("_treeId" -> _tree, "$or" -> Json.arr(
        Json.obj("edge.source" -> edge.source, "edge.target" -> edge.target),
        Json.obj("edge.source" -> edge.target, "edge.targetcc" -> edge.source))))
  }

  def deleteEdgesOfNode(nodeId: Int, _tree: BSONObjectID)(implicit ctx: DBAccessContext) = {
    remove(
      Json.obj("_treeId" -> _tree, "$or" -> Json.arr(
        Json.obj("edge.source" -> nodeId),
        Json.obj("edge.target" -> nodeId))))
  }

  def countEdgesOfNode(nodeId: Int, _tree: BSONObjectID)(implicit ctx: DBAccessContext) = {
    count(
      Json.obj("_treeId" -> _tree, "$or" -> Json.arr(
        Json.obj("edge.source" -> nodeId),
        Json.obj("edge.target" -> nodeId))))
  }
}
