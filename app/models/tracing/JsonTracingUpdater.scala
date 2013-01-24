package models.tracing

import play.api.libs.json._
import models.Color
import play.api.Logger

object TracingUpdater {

  implicit object TracingUpdateReads extends Reads[TracingUpdater] {
    def reads(js: JsValue) = {
      val value = (js \ "value").as[JsObject]
      JsSuccess((js \ "action").as[String] match {
        case "createTree"        => CreateTree(value)
        case "deleteTree"        => DeleteTree(value)
        case "updateTree"        => UpdateTree(value)
        case "mergeTree"         => MergeTree(value)
        case "moveTreeComponent" => MoveTreeComponent(value)
        case "createNode"        => CreateNode(value)
        case "deleteNode"        => DeleteNode(value)
        case "updateNode"        => UpdateNode(value)
        case "createEdge"        => CreateEdge(value)
        case "deleteEdge"        => DeleteEdge(value)
        case "updateTracing"     => UpdateTracing(value)
      })
    }
  }

  def createUpdateFromJson(js: JsValue): Option[TracingUpdate] = {
    try {
      val updater = js.as[TracingUpdater]
      Some(updater.createUpdate())
    } catch {
      case e: java.lang.RuntimeException =>
        Logger.error("Invalid json: " + e)
        None
    }
  }
}

case class TracingUpdate(update: Tracing => Tracing)

trait TracingUpdater {
  def createUpdate(): TracingUpdate
}

case class CreateTree(value: JsObject) extends TracingUpdater {
  def createUpdate() = {
    val id = (value \ "id").as[Int]
    val color = (value \ "color").as[Color]
    TracingUpdate { t =>
      val tree = DBTree.insertOne(DBTree(id, color))
      t.update(_.addEmptyTree(tree))
    }
  }
}

case class DeleteTree(value: JsObject) extends TracingUpdater {
  def createUpdate() = {
    val id = (value \ "id").as[Int]
    TracingUpdate { t =>
      t.tree(id).map { tree =>
        DBTree.remove(tree)
        t.update(_.removeTree(tree))
      } getOrElse t
    }
  }
}

case class UpdateTree(value: JsObject) extends TracingUpdater {
  def createUpdate() = {
    val id = (value \ "id").as[Int]
    val color = (value \ "color").as[Color]
    TracingUpdate { t =>
      t.tree(id).map { tree =>
        tree.update(_.copy(color = color, treeId = id))
      }
      t
    }
  }
}

case class MergeTree(value: JsObject) extends TracingUpdater {
  def createUpdate() = {
    val sourceId = (value \ "sourceId").as[Int]
    val targetId = (value \ "targetId").as[Int]
    TracingUpdate { t =>
      (for {
        source <- t.tree(sourceId)
        target <- t.tree(targetId)
      } yield {
        DBTree.moveAllNodes(source._id, target._id)
        DBTree.moveAllEdges(source._id, target._id)

        t.update(_.removeTree(source))
      }) getOrElse t
    }
  }
}

case class MoveTreeComponent(value: JsObject) extends TracingUpdater {
  import nml.Node
  def createUpdate() = {
    val nodeIds = (value \ "nodeIds").as[List[Int]]
    val sourceId = (value \ "sourceId").as[Int]
    val targetId = (value \ "targetId").as[Int]
    TracingUpdate { t =>
      for {
        source <- t.tree(sourceId)
        target <- t.tree(targetId)
      } {
        DBTree.moveTreeComponent(nodeIds, source._id, target._id)
      }
      t
    }
  }
}

case class CreateNode(value: JsObject) extends TracingUpdater {
  import nml.Node
  def createUpdate() = {
    val node = value.as[Node]
    val treeId = (value \ "treeId").as[Int]
    TracingUpdate { t =>
      t.tree(treeId).map { tree =>
        DBTree.insertNode(node, tree._id)
      }
      t
    }
  }
}

case class DeleteNode(value: JsObject) extends TracingUpdater {
  import nml.Node
  def createUpdate() = {
    val nodeId = (value \ "id").as[Int]
    val treeId = (value \ "treeId").as[Int]
    TracingUpdate { t =>
      t.tree(treeId).map { tree =>
        DBTree.deleteNode(nodeId, tree._id)
        DBTree.deleteEdgesOfNode(nodeId, tree._id)
      }
      t
    }
  }
}

case class UpdateNode(value: JsObject) extends TracingUpdater {
  import nml.Node
  def createUpdate() = {
    val node = value.as[Node]
    val treeId = (value \ "treeId").as[Int]
    TracingUpdate { t =>
      t.tree(treeId).map { tree =>
        DBTree.updateNode(node, tree._id)
      }
      t
    }
  }
}

case class CreateEdge(value: JsObject) extends TracingUpdater {
  import nml.Edge
  def createUpdate() = {
    val edge = value.as[Edge]
    val treeId = (value \ "treeId").as[Int]
    TracingUpdate { t =>
      t.tree(treeId).map { tree =>
        DBTree.insertEdge(edge, tree._id)
      }
      t
    }
  }
}

case class DeleteEdge(value: JsObject) extends TracingUpdater {
  import nml.Edge
  def createUpdate() = {
    val edge = value.as[Edge]
    val treeId = (value \ "treeId").as[Int]
    TracingUpdate { t =>
      t.tree(treeId).map { tree =>
        DBTree.deleteEdge(edge, tree._id)
      }
      t
    }
  }
}

case class UpdateTracing(value: JsObject) extends TracingUpdater {
  import nml.BranchPoint
  import nml.Comment
  import brainflight.tools.geometry.Point3D
  def createUpdate() = {
    val branchPoints = (value \ "branchPoints").as[List[BranchPoint]]
    val comments = (value \ "comments").as[List[Comment]]
    val activeNodeId = (value \ "activeNodeId").as[Int]
    val editPosition = (value \ "editPosition").as[Point3D]
    TracingUpdate { t =>
      t.update(_.copy(
        branchPoints = branchPoints,
        comments = comments,
        activeNodeId = activeNodeId,
        editPosition = editPosition))
    }
  }
}