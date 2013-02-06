package models.tracing

import play.api.libs.json.Writes
import play.api.libs.json.Json
import xml.XMLWrites
import xml.Xml
import nml.Edge
import org.bson.types.ObjectId

case class DBEdge(edge: Edge, _treeId: ObjectId, _id: ObjectId = new ObjectId)

object DBEdge {

  implicit object DBEdgeXMLWrites extends XMLWrites[DBEdge] {
    import Edge._
    def writes(e: DBEdge) =
      Xml.toXML(e.edge)
  }

  implicit object DBEdgeWrites extends Writes[DBEdge] {
    import Edge._
    def writes(e: DBEdge) = Json.toJson(e.edge)
  }
}