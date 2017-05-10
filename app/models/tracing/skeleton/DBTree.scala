package models.tracing.skeleton

import com.scalableminds.util.image.Color
import models.basics._
import oxalis.nml.{BranchPoint, Comment, Tree, TreeLike}
import reactivemongo.bson.BSONObjectID
import reactivemongo.play.json.BSONFormats._
import play.api.libs.json.Json
import scala.concurrent.Future

import com.scalableminds.util.reactivemongo.{DBAccessContext, GlobalAccessContext}
import scala.async.Async._

import play.api.libs.concurrent.Execution.Implicits._
import reactivemongo.api.indexes.{Index, IndexType}
import com.scalableminds.util.tools.Fox
import play.api.libs.functional.syntax._
import play.api.libs.json.Json._
import play.api.libs.json._

case class DBTree(
  _tracing: BSONObjectID,
  treeId: Int,
  color: Option[Color],
  branchPoints: List[BranchPoint] = Nil,
  comments: List[Comment] = Nil,
  timestamp: Long = System.currentTimeMillis,
  name: String = "",
  _id: BSONObjectID = BSONObjectID.generate) {

  val dao = DBTree

  def id = _id.stringify

  def isEmpty = {
    for {
      oneNode <- DBNodeDAO.findOneByTree(_id)(GlobalAccessContext).futureBox
      oneEdge <- DBEdgeDAO.findOneByTree(_id)(GlobalAccessContext).futureBox
    } yield oneNode.isEmpty && oneEdge.isEmpty
  }

  def nodes = DBNodeDAO.findByTree(_id)(GlobalAccessContext).map(_.map(_.node).toSet)

  def edges = DBEdgeDAO.findByTree(_id)(GlobalAccessContext).map(_.map(_.edge).toSet)

  def numberOfNodes =
    DBNodeDAO.countByTree(_id)(GlobalAccessContext)

  def numberOfEdges =
    DBEdgeDAO.countByTree(_id)(GlobalAccessContext)

  def toTree = for{
    ns <- nodes
    es <- edges
  } yield Tree(treeId, ns, es, color, branchPoints, comments, name)
}

object DBTreeService {
  def insert(_tracing: BSONObjectID, t: TreeLike)(implicit ctx: DBAccessContext): Fox[DBTree] = {
    val tree = DBTree.createFrom(_tracing, t)
    for {
      _ <- DBTreeDAO.insert(tree)
      _ <- DBNodeDAO.bulkInsert(t.nodes.map(DBNode(_, tree._id)).toSeq)
      _ <- DBEdgeDAO.bulkInsert(t.edges.map(DBEdge(_, tree._id)).toSeq)
    } yield {
      tree
    }
  }

  def removeByTracing(_tracing: BSONObjectID)(implicit ctx: DBAccessContext) = {
    for {
      trees <- DBTreeDAO.findByTracing(_tracing)
      _ <- Fox.combined(trees.map(tree => remove(tree._id)))
    } yield {
      true
    }
  }

  def remove(_tree: BSONObjectID)(implicit ctx: DBAccessContext) = {
    for {
      _ <- DBNodeDAO.removeAllOf(_tree)
      _ <- DBEdgeDAO.removeAllOf(_tree)
      _ <- DBTreeDAO.removeById(_tree)
    } yield {
      true
    }
  }

  def moveNodesAndEdges(nodeIds: List[Int], _source: BSONObjectID, _target: BSONObjectID)(implicit ctx: DBAccessContext) = {
    for {
      _ <- DBNodeDAO.moveNodes(nodeIds, _source, _target)
      _ <- DBEdgeDAO.moveEdges(nodeIds, _source, _target)
      _ <- DBEdgeDAO.removeAllOnBorder(nodeIds, _source)
    } yield true
  }
}

object DBTree {
  implicit val dbTreeFormat = Json.format[DBTree]

  val dbTreeUpdateWrites: Writes[DBTree] =
    ((__ \ "color").writeNullable[Color] and
      (__ \ "timestamp").write[Long] and
      (__ \ "comments").write[List[Comment]] and
      (__ \ "branchPoints").write[List[BranchPoint]] and
      (__ \ "name").write[String])(tree => (tree.color, tree.timestamp, tree.comments, tree.branchPoints, tree.name))

  def empty(_tracing: BSONObjectID) = DBTree(
    _tracing,
    1,
    None,
    List.empty,
    List.empty,
    System.currentTimeMillis(),
    "")

  // def nameFromId(treeId: Int) = f"Tree$treeId%03d"

  def createFrom(tracingId: BSONObjectID, t: TreeLike) = {
    // val name =
    //   if (t.name != "")
    //     t.name
    //   else
    //     DBTree.nameFromId(t.treeId)
    DBTree(tracingId, t.treeId, t.color, t.branchPoints, t.comments, t.timestamp, t.name)
  }

  def createCopy(t: DBTree, tid: BSONObjectID) =
    t.copy(_id = BSONObjectID.generate, _tracing = tid)
}

object DBTreeDAO extends SecuredBaseDAO[DBTree] {

  val collectionName = "trees"

  val formatter = DBTree.dbTreeFormat

  underlying.indexesManager.ensure(Index(Seq("_tracing" -> IndexType.Ascending)))

  def insertEmptyTree(_tracing: BSONObjectID)(implicit ctx: DBAccessContext) =
    insert(DBTree.empty(_tracing))

  def findByTracing(_tracing: BSONObjectID)(implicit ctx: DBAccessContext) = withExceptionCatcher{
    find("_tracing", _tracing).collect[List]()
  }

  def removeAllOf(_tracing: BSONObjectID)(implicit ctx: DBAccessContext) =
    remove("_tracing", _tracing)

  def findOneByTreeId(_tracing: BSONObjectID, treeId: Int)(implicit ctx: DBAccessContext) =
    findOne(Json.obj("_tracing" -> _tracing, "treeId" -> treeId))

  def updateOrInsert(_tracing: BSONObjectID, tree: DBTree)(implicit ctx: DBAccessContext) =
    update(
      Json.obj("_tracing" -> _tracing, "treeId" -> tree.treeId),
      Json.obj("$set" -> DBTree.dbTreeUpdateWrites.writes(tree),
               "$setOnInsert" -> formatter.writes(tree)))
}
