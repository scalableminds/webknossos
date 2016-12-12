package models.tracing.skeleton

import com.scalableminds.util.geometry.Vector3D
import play.api.libs.json._
import com.scalableminds.util.image.Color
import com.typesafe.scalalogging.LazyLogging
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import scala.concurrent.Future

import play.api.libs.concurrent.Execution.Implicits._
import com.scalableminds.util.reactivemongo.DBAccessContext
import oxalis.nml.{BranchPoint, Comment}

object TracingUpdater extends LazyLogging {

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
        logger.error("Invalid json: " + e + "\n While trying to parse:\n" + Json.prettyPrint(js))
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
    val name = (value \ "name").asOpt[String].getOrElse(DBTree.nameFromId(id))
    val branchPoints = (value \ "branchPoints").as[List[BranchPoint]]
    val comments = (value \ "comments").as[List[Comment]]
    TracingUpdate { t =>
      for {
        updatedTracing <- t.updateStatistics(_.createTree) ?~> "Failed to update tracing statistics."
        _ <- DBTreeDAO.insert(DBTree(t._id, id, color, branchPoints, comments, timestamp, name)) ?~> "Failed to insert tree."
      } yield updatedTracing
    }
  }
}

case class DeleteTree(value: JsObject) extends TracingUpdater {
  def createUpdate()(implicit ctx: DBAccessContext) = {
    val id = (value \ "id").as[Int]
    TracingUpdate { t =>
      for {
        tree <- t.tree(id).toFox ?~> "Failed to access tree."
        updatedTracing <- t.updateStatistics(_.deleteTree(tree)) ?~> "Failed to update tracing statistics."
        _ <- DBTreeService.remove(tree._id) ?~> "Failed to remove tree."
      } yield updatedTracing
    }
  }
}

case class UpdateTree(value: JsObject) extends TracingUpdater {
  def createUpdate()(implicit ctx: DBAccessContext) = {
    val id = (value \ "id").as[Int]
    val updatedId = (value \ "updatedId").asOpt[Int].getOrElse(id)
    val color = (value \ "color").asOpt[Color]
    val name = (value \ "name").asOpt[String].getOrElse(DBTree.nameFromId(id))
    val branchPoints = (value \ "branchPoints").as[List[BranchPoint]]
    val comments = (value \ "comments").as[List[Comment]]
    TracingUpdate { t =>
      for {
        tree <- t.tree(id).toFox ?~> "Failed to access tree."
        updated = tree.copy(
          color = color orElse tree.color,
          treeId = updatedId,
          branchPoints = branchPoints,
          comments = comments,
          name = name)
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
        updatedTracing <- t.updateStatistics(_.mergeTree) ?~> "Failed to update tracing statistics."
        _ <- DBNodeDAO.moveAllNodes(source._id, target._id) ?~> "Failed to move all nodes."
        _ <- DBEdgeDAO.moveAllEdges(source._id, target._id) ?~> "Failed to move all edges."
        updated = target.copy(
          branchPoints = target.branchPoints ::: source.branchPoints,
          comments = target.comments ::: source.comments)
        _ <- DBTreeDAO.update(target._id, updated) ?~> "Failed to update tree."
        _ <- DBTreeService.remove(source._id) ?~> "Failed to remove source tree."
      } yield updatedTracing
    }
  }
}

case class MoveTreeComponent(value: JsObject) extends TracingUpdater {

  def createUpdate()(implicit ctx: DBAccessContext) = {
    val nodeIds = (value \ "nodeIds").as[List[Int]]
    val sourceId = (value \ "sourceId").as[Int]
    val targetId = (value \ "targetId").as[Int]
    TracingUpdate { t =>
      for {
        source <- t.tree(sourceId).toFox ?~> "Failed to access source tree."
        target <- t.tree(targetId).toFox ?~> "Failed to access target tree."
        _ <- DBTreeService.moveNodesAndEdges(nodeIds, source._id, target._id) ?~> "Failed to move tree compontents."
        (movedBp, remainingBp) = source.branchPoints.partition(bp => nodeIds.contains(bp.id))
        (movedC, remainingC) = source.comments.partition(c => nodeIds.contains(c.node))
        updatedSource = source.copy(branchPoints = remainingBp, comments = remainingC)
        updatedTarget = target.copy(branchPoints = movedBp ::: target.branchPoints, comments = movedC ::: target.comments)
        _ <- DBTreeDAO.update(target._id, updatedTarget) ?~> "Failed to update tree."
        _ <- DBTreeDAO.update(source._id, updatedSource) ?~> "Failed to update tree."
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
        updatedTracing <- t.updateStatistics(_.createNode) ?~> "Failed to update tracing statistics."
        _ <- DBNodeDAO.insert(DBNode(node, tree._id)) ?~> "Failed to insert node into tree."
      } yield updatedTracing
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
        updatedTracing <- t.updateStatistics(_.deleteNode(nodeId, tree)) ?~> "Failed to update tracing statistics."
        _ <- DBNodeDAO.remove(nodeId, tree._id) ?~> "Failed to remove node."
        _ <- DBEdgeDAO.deleteEdgesOfNode(nodeId, tree._id) ?~> "Failed to remove edges of node."
      } yield updatedTracing
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
        updatedTracing <- t.updateStatistics(_.createEdge) ?~> "Failed to update tracing statistics."
        _ <- DBEdgeDAO.insert(DBEdge(edge, tree._id)) ?~> "Failed to insert edge."
      } yield updatedTracing
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
        updatedTracing <- t.updateStatistics(_.deleteEdge) ?~> "Failed to update tracing statistics."
        _ <- DBEdgeDAO.remove(edge, tree._id) ?~> "Failed to remove edge."
      } yield updatedTracing
    }
  }
}

case class UpdateTracing(value: JsObject) extends TracingUpdater {

  import oxalis.nml.BranchPoint
  import oxalis.nml.Comment
  import com.scalableminds.util.geometry.Point3D

  def createUpdate()(implicit ctx: DBAccessContext) = {
    val activeNodeId = (value \ "activeNode").asOpt[Int]
    val editPosition = (value \ "editPosition").as[Point3D]
    val editRotation = (value \ "editRotation").as[Vector3D]
    val zoomLevel = (value \ "zoomLevel").as[Double]
    TracingUpdate { t =>
      val updated = t.copy(
        activeNodeId = activeNodeId,
        editPosition = editPosition,
        editRotation = editRotation,
        zoomLevel = zoomLevel)
      SkeletonTracingService.update(t._id, updated).map(_ => updated) ?~> "Failed to update tracing."
    }
  }
}
