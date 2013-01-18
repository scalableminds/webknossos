package models.graph.copy

import brainflight.tools.geometry.Point3D
import xml.XMLWrites
import com.novus.salat.annotations._
import org.bson.types.ObjectId
import play.api.libs.json.Format
import play.api.libs.json.JsObject
import play.api.libs.json.Json
import play.api.libs.json.JsValue

case class Node(id: Int, radius: Float, position: Point3D, viewport: Int, resolution: Int, timestamp: Long)

object Node {
  implicit object NodeXMLWrites extends XMLWrites[Node] {
    def writes(n: Node) =
      <node id={ n.id.toString } radius={ n.radius.toString } x={ n.position.x.toString } y={ n.position.y.toString } z={ (n.position.z).toString } inVp={ n.viewport.toString } inMag={ n.resolution.toString } time={ n.timestamp.toString }/>
  }
  
  implicit object NodeFormat extends Format[Node] {
    val ID = "id"
    val RADIUS = "radius"
    val POSITION = "position"
    val VIEWPORT = "viewport"
    val RESOLUTION = "resolution"
    val TIMESTAMP = "timestamp"

    def writes(n: Node): JsObject = {
      Json.obj(
        ID -> n.id,
        RADIUS -> n.radius,
        POSITION -> n.position,
        VIEWPORT -> n.viewport,
        RESOLUTION -> n.resolution,
        TIMESTAMP -> n.timestamp
      )
    }

    def reads(js: JsValue) =
      Node((js \ ID).as[Int],
        (js \ RADIUS).as[Float],
        (js \ POSITION).as[Point3D],
        (js \ VIEWPORT).as[Int],
        (js \ RESOLUTION).as[Int],
        (js \ TIMESTAMP).as[Long])
  }
}