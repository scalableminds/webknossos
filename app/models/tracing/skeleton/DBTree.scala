package models.tracing.skeleton

import braingames.image.Color
import models.basics._
import oxalis.nml.Tree
import oxalis.nml.TreeLike
import reactivemongo.bson.BSONObjectID
import play.modules.reactivemongo.json.BSONFormats._
import play.api.libs.json.Json
import scala.concurrent.Future
import braingames.reactivemongo.{GlobalAccessContext, DBAccessContext}
import scala.async.Async._
import play.api.libs.concurrent.Execution.Implicits._

case class DBTree(_tracing: BSONObjectID, treeId: Int, color: Color, timestamp: Long = System.currentTimeMillis, name: String = "", _id: BSONObjectID = BSONObjectID.generate) {
  val dao = DBTree

  def id = _id.stringify

  def isEmpty = async {
    val oneNode = await(DBNodeDAO.findOneByTree(_id)(GlobalAccessContext))
    val oneEdge = await(DBEdgeDAO.findOneByTree(_id)(GlobalAccessContext))

    oneNode.isEmpty && oneEdge.isEmpty
  }

  def nodes = DBNodeDAO.findByTree(_id)(GlobalAccessContext).map(_.map(_.node).toSet)

  def edges = DBEdgeDAO.findByTree(_id)(GlobalAccessContext).map(_.map(_.edge).toSet)

  def numberOfNodes =
    DBNodeDAO.countByTree(_id)(GlobalAccessContext)

  def numberOfEdges =
    DBEdgeDAO.countByTree(_id)(GlobalAccessContext)

  def toTree = async {
    Tree(treeId, await(nodes), await(edges), color, name)
  }
}

object DBTreeService {
  def insert(_tracing: BSONObjectID, t: TreeLike)(implicit ctx: DBAccessContext): Future[DBTree] = {
    val tree = DBTree.createFrom(_tracing, t)
    for {
      _ <- DBTreeDAO.insert(tree)
      _ <- Future.traverse(t.nodes)(n => DBNodeDAO.insert(DBNode(n, tree._id)))
      _ <- Future.traverse(t.edges)(e => DBEdgeDAO.insert(DBEdge(e, tree._id)))
    } yield {
      tree
    }
  }

  def removeByTracing(_tracing: BSONObjectID)(implicit ctx: DBAccessContext) = {
    for {
      trees <- DBTreeDAO.findByTracing(_tracing)
      _ <- Future.traverse(trees)(tree => remove(tree._id))
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

  def moveTreeComponent(nodeIds: List[Int], _source: BSONObjectID, _target: BSONObjectID)(implicit ctx: DBAccessContext) = {
    for {
      _ <- DBNodeDAO.moveNodes(nodeIds, _source, _target)
      _ <- DBEdgeDAO.moveEdges(nodeIds, _source, _target)
      _ <- DBEdgeDAO.removeAllOnBorder(nodeIds, _source)
    } yield true
  }
}

object DBTree {
  implicit val dbTreeFormat = Json.format[DBTree]

  def empty(_tracing: BSONObjectID) = DBTree(_tracing, 1, Color(1, 0, 0, 0), System.currentTimeMillis(), nameFromId(1))

  def nameFromId(treeId: Int) = "Tree%03d".format(treeId)

  def createFrom(tracingId: BSONObjectID, t: TreeLike) = {
    val name =
      if (t.name == "")
        DBTree.nameFromId(t.treeId)
      else
        t.name
    DBTree(tracingId, t.treeId, t.color, t.timestamp, name)
  }

  def createCopy(t: DBTree, tid: BSONObjectID) =
    t.copy(_id = BSONObjectID.generate, _tracing = tid)
}

object DBTreeDAO extends SecuredBaseDAO[DBTree] {

  val collectionName = "trees"

  val formatter = DBTree.dbTreeFormat

  // TODO: ensure index
  // this.collection.ensureIndex("_tracing")

  /*def createAndInsertDeepCopy(t: DBTree): DBTree = {
    createAndInsertDeepCopy(t, t._tracing, 0)
  }*/

  def insertEmptyTree(_tracing: BSONObjectID)(implicit ctx: DBAccessContext) =
    insert(DBTree.empty(_tracing))

  def findByTracing(_tracing: BSONObjectID)(implicit ctx: DBAccessContext) =
    find("_tracing", _tracing).collect[List]()

  def removeAllOf(_tracing: BSONObjectID)(implicit ctx: DBAccessContext) =
    remove("_tracing", _tracing)

  def findOneByTreeId(_tracing: BSONObjectID, treeId: Int)(implicit ctx: DBAccessContext) =
    findOne(Json.obj("_tracing" -> _tracing, "treeId" -> treeId))
}