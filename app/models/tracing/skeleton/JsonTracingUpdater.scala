package models.tracing.skeleton

import play.api.libs.json._
import com.scalableminds.util.image.Color
import play.api.Logger
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import scala.concurrent.Future
import play.api.libs.concurrent.Execution.Implicits._
import com.scalableminds.util.reactivemongo.DBAccessContext

object TracingUpdater {

  implicit object TracingUpdateReads extends Reads[TracingUpdater] {
    def reads(js: JsValue) = {
      val value = (js \ "value").as[JsObject]
      JsSuccess((js \ "action").as[String] match {
        case "createTree" => CreateTree(value)
        case "deleteTree" => DeleteTree(value)
        case "updateTree" => UpdateTree(value)
        case "mergeTree" => MergeTree(value)
        case "moveTreeComponent" => MoveTreeComponent(value)
        case "createNode" => CreateNode(value)
        case "deleteNode" => DeleteNode(value)
        case "updateNode" => UpdateNode(value)
        case "createEdge" => CreateEdge(value)
        case "deleteEdge" => DeleteEdge(value)
        case "updateTracing" => UpdateTracing(value)
      })
    }
  }

  def createUpdateFromJson(js: JsValue)(implicit ctx: DBAccessContext): Option[TracingUpdate] = {
    try {
      val updater = js.as[TracingUpdater]
      Some(updater.createUpdate())
    } catch {
      case e: java.lang.RuntimeException =>
        Logger.error("Invalid json: " + e + "\n While trying to parse:\n" + Json.prettyPrint(js))
        None
    }
  }
}

case class TracingUpdate(update: SkeletonTracing => Fox[SkeletonTracing])

trait TracingUpdater extends FoxImplicits {
  def createUpdate()(implicit ctx: DBAccessContext): TracingUpdate
}

case class CreateTree(value: JsObject) extends TracingUpdater {
  def createUpdate()(implicit ctx: DBAccessContext) = {
    val id = (value \ "id").as[Int]
    val color = (value \ "color").asOpt[Color]
    val timestamp = (value \ "timestamp").as[Long]
    val name = (value \ "name").asOpt[String] getOrElse (DBTree.nameFromId(id))
    TracingUpdate { t =>
      DBTreeDAO.insert(DBTree(t._id, id, color, timestamp, name)).map(_ => t) ?~> "Failed to insert tree."
    }
  }
}

case class DeleteTree(value: JsObject) extends TracingUpdater {
  def createUpdate()(implicit ctx: DBAccessContext) = {
    val id = (value \ "id").as[Int]
    TracingUpdate { t =>
      t.tree(id).toFox.flatMap { tree =>
        DBTreeService.remove(tree._id).map(_ => t) ?~> "Failed to remove tree."
      }
    }
  }
}

case class UpdateTree(value: JsObject) extends TracingUpdater {
  def createUpdate()(implicit ctx: DBAccessContext) = {
    val id = (value \ "id").as[Int]
    val updatedId = (value \ "updatedId").asOpt[Int] getOrElse id
    val color = (value \ "color").asOpt[Color]
    val name = (value \ "name").asOpt[String] getOrElse (DBTree.nameFromId(id))
    TracingUpdate { t =>
      for{
        tree <- t.tree(id).toFox ?~> "Failed to access tree."
        updated = tree.copy(color = color orElse tree.color, treeId = updatedId, name = name)
        _ <- DBTreeDAO.update(tree._id, updated) ?~> "Failed to update tree."
      } yield t
    }
  }
}

case class MergeTree(value: JsObject) extends TracingUpdater {
  def createUpdate()(implicit ctx: DBAccessContext) = {
    val sourceId = (value \ "sourceId").as[Int]
    val targetId = (value \ "targetId").as[Int]
    TracingUpdate { t =>
      for {
        source <- t.tree(sourceId).toFox ?~> "Failed to access source tree."
        target <- t.tree(targetId).toFox ?~> "Failed to access target tree."
        _ <- DBNodeDAO.moveAllNodes(source._id, target._id) ?~> "Failed to move all nodes."
        _ <- DBEdgeDAO.moveAllEdges(source._id, target._id) ?~> "Failed to move all edges."
        _ <- DBTreeService.remove(source._id) ?~> "Failed to remove source tree."
      } yield t
    }
  }
}

case class MoveTreeComponent(value: JsObject) extends TracingUpdater {

  import oxalis.nml.Node

  def createUpdate()(implicit ctx: DBAccessContext) = {
    val nodeIds = (value \ "nodeIds").as[List[Int]]
    val sourceId = (value \ "sourceId").as[Int]
    val targetId = (value \ "targetId").as[Int]
    TracingUpdate { t =>
      for {
        source <- t.tree(sourceId).toFox ?~> "Failed to access source tree."
        target <- t.tree(targetId).toFox ?~> "Failed to access target tree."
        _ <- DBTreeService.moveTreeComponent(nodeIds, source._id, target._id) ?~> "Failed to move tree compontents."
      } yield t
    }
  }
}

case class CreateNode(value: JsObject) extends TracingUpdater {

  import oxalis.nml.Node

  def createUpdate()(implicit ctx: DBAccessContext) = {
    val node = value.as[Node]
    val treeId = (value \ "treeId").as[Int]
    TracingUpdate { t =>
      for {
        tree <- t.tree(treeId).toFox ?~> "Failed to access tree."
        _ <- DBNodeDAO.insert(DBNode(node, tree._id)) ?~> "Failed to insert node into tree."
      } yield t
    }
  }
}

case class DeleteNode(value: JsObject) extends TracingUpdater {

  import oxalis.nml.Node

  def createUpdate()(implicit ctx: DBAccessContext) = {
    val nodeId = (value \ "id").as[Int]
    val treeId = (value \ "treeId").as[Int]
    TracingUpdate { t =>
      for {
        tree <- t.tree(treeId).toFox ?~> "Failed to access tree."
        _ <- DBNodeDAO.remove(nodeId, tree._id) ?~> "Failed to remove node."
        _ <- DBEdgeDAO.deleteEdgesOfNode(nodeId, tree._id) ?~> "Failed to remove edges of node."
      } yield t
    }
  }
}

case class UpdateNode(value: JsObject) extends TracingUpdater {

  import oxalis.nml.Node

  def createUpdate()(implicit ctx: DBAccessContext) = {
    val node = value.as[Node]
    val treeId = (value \ "treeId").as[Int]
    TracingUpdate { t =>
      for {
        tree <- t.tree(treeId).toFox ?~> "Failed to access tree."
        _ <- DBNodeDAO.updateNode(node, tree._id) ?~> "Failed to update node."
      } yield t
    }
  }
}

case class CreateEdge(value: JsObject) extends TracingUpdater {

  import oxalis.nml.Edge

  def createUpdate()(implicit ctx: DBAccessContext) = {
    val edge = value.as[Edge]
    val treeId = (value \ "treeId").as[Int]
    TracingUpdate { t =>
      for {
        tree <- t.tree(treeId).toFox ?~> "Failed to access tree."
        _ <- DBEdgeDAO.insert(DBEdge(edge, tree._id)) ?~> "Failed to insert edge."
      } yield t
    }
  }
}

case class DeleteEdge(value: JsObject) extends TracingUpdater {

  import oxalis.nml.Edge

  def createUpdate()(implicit ctx: DBAccessContext) = {
    val edge = value.as[Edge]
    val treeId = (value \ "treeId").as[Int]
    TracingUpdate { t =>
      for {
        tree <- t.tree(treeId).toFox ?~> "Failed to access tree."
        _ <- DBEdgeDAO.remove(edge, tree._id) ?~> "Failed to remove edge."
      } yield t
    }
  }
}

case class UpdateTracing(value: JsObject) extends TracingUpdater {

  import oxalis.nml.BranchPoint
  import oxalis.nml.Comment
  import com.scalableminds.util.geometry.Point3D

  def createUpdate()(implicit ctx: DBAccessContext) = {
    val branchPoints = (value \ "branchPoints").as[List[BranchPoint]]
    val comments = (value \ "comments").as[List[Comment]]
    val activeNodeId = (value \ "activeNode").asOpt[Int]
    val editPosition = (value \ "editPosition").as[Point3D]
    val zoomLevel = (value \ "zoomLevel").as[Double]
    TracingUpdate { t =>
      val updated = t.copy(
        branchPoints = branchPoints,
        comments = comments,
        activeNodeId = activeNodeId,
        editPosition = editPosition,
        zoomLevel = zoomLevel)
      SkeletonTracingDAO.update(t._id, updated).map(_ => updated) ?~> "Failed to update tracing."
    }
  }
}
