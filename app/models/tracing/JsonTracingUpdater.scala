package models.tracing

import play.api.libs.json._
import models.Color

object TracingUpdate {
  implicit object TracingUpdateReads extends Reads[TracingUpdate] {
    def reads(js: JsValue) = {
      val value = (js \ "value").as[JsObject]
      (js \ "action").as[String] match {
        case "createTree"    => CreateTree(value)
        case "deleteTree"    => DeleteTree(value)
        case "updateTree"    => UpdateTree(value)
        case "createNode"    => CreateNode(value)
        case "deleteNode"    => DeleteNode(value)
        case "updateNode"    => UpdateNode(value)
        case "createEdge"    => CreateEdge(value)
        case "deleteEdge"    => DeleteEdge(value)
        case "updateTracing" => UpdateTracing(value)
      }
    }
  }

}

trait TracingUpdate {
  def executeUpdate(t: Tracing): Tracing
}

case class CreateTree(value: JsObject) extends TracingUpdate {
  def executeUpdate(t: Tracing) = {
    val id = (value \ "id").as[Int]
    val color = (value \ "color").as[Color]
    val tree = DBTree.insertOne(DBTree(id, color))
    t.update(_.addTree(tree))
  }
}

case class DeleteTree(value: JsObject) extends TracingUpdate {
  def executeUpdate(t: Tracing) = {
    val id = (value \ "id").as[Int]
    t.tree(id).map { tree =>
      DBTree.remove(tree)
      t.update(_.removeTree(tree))
    } getOrElse t
  }
}

case class UpdateTree(value: JsObject) extends TracingUpdate {
  def executeUpdate(t: Tracing) = {
    val id = (value \ "id").as[Int]
    val color = (value \ "color").as[Color]
    t.tree(id).map { tree =>
      tree.update(_.copy(color = color, treeId = id))
    }
    t
  }
}

case class CreateNode(value: JsObject) extends TracingUpdate {
  import nml.Node
  def executeUpdate(t: Tracing) = {
    val node = value.as[Node]
    val treeId = (value \ "treeId").as[Int]
    t.tree(treeId).map { tree =>
      DBTree.insertNode(node, tree._id)
    }
    t
  }
}

case class DeleteNode(value: JsObject) extends TracingUpdate {
  import nml.Node
  def executeUpdate(t: Tracing) = {
    val nodeId = (value \ "id").as[Int]
    val treeId = (value \ "treeId").as[Int]
    t.tree(treeId).map { tree =>
      DBTree.deleteNode(nodeId, tree._id)
    }
    t
  }
}

case class UpdateNode(value: JsObject) extends TracingUpdate {
  import nml.Node
  def executeUpdate(t: Tracing) = {
    val node = value.as[Node]
    val treeId = (value \ "treeId").as[Int]
    t.tree(treeId).map { tree =>
      DBTree.updateNode(node, tree._id)
    }
    t
  }
}

case class CreateEdge(value: JsObject) extends TracingUpdate {
  import nml.Edge
  def executeUpdate(t: Tracing) = {
    val edge = value.as[Edge]
    val treeId = (value \ "treeId").as[Int]
    t.tree(treeId).map { tree =>
      DBTree.insertEdge(edge, tree._id)
    }
    t
  }
}

case class DeleteEdge(value: JsObject) extends TracingUpdate {
  import nml.Edge
  def executeUpdate(t: Tracing) = {
    val edge = value.as[Edge]
    val treeId = (value \ "treeId").as[Int]
    t.tree(treeId).map { tree =>
      DBTree.deleteEdge(edge, tree._id)
    }
    t
  }
}

case class UpdateTracing(value: JsObject) extends TracingUpdate {
  import nml.BranchPoint
  import nml.Comment
  import brainflight.tools.geometry.Point3D
  def executeUpdate(t: Tracing) = {
    val branchPoints = (value \ "branchPoints").as[List[BranchPoint]]
    val comments = (value \ "comments").as[List[Comment]]
    val activeNodeId = (value \ "activeNodeId").as[Int]
    val editPosition = (value \ "editPosition").as[Point3D]

    t.update(_.copy(
      branchPoints = branchPoints,
      comments = comments,
      activeNodeId = activeNodeId,
      editPosition = editPosition))
  }
}