package models.tracing

import play.api.libs.json.Writes
import play.api.libs.json.Json
import xml.XMLWrites
import xml.Xml
import nml.Node
import org.bson.types.ObjectId

case class DBNode(node: Node, _treeId: ObjectId, _id: ObjectId = new ObjectId)

object DBNode{
  def createFrom(n: Node, _treeId: ObjectId) = {
    DBNode(n, new ObjectId, _treeId)
  }

  implicit object DBNodeXMLWrites extends XMLWrites[DBNode] {
    import Node._
    def writes(n: DBNode) =
      Xml.toXML(n.node)
  }

  implicit object DBNodeWrites extends Writes[DBNode] {
    import Node._
    def writes(n: DBNode) = Json.toJson(n.node)
  }
}