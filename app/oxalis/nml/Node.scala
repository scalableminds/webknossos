package oxalis.nml

import braingames.geometry.Point3D
import com.novus.salat.annotations._
import play.api.libs.json._
import braingames.xml.XMLWrites

case class Node(id: Int, position: Point3D, radius: Float = 120, viewport: Int = 1, resolution: Int = 1, timestamp: Long = System.currentTimeMillis)

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
      JsSuccess(Node((js \ ID).as[Int],
        (js \ POSITION).as[Point3D],
        (js \ RADIUS).as[Float],
        (js \ VIEWPORT).as[Int],
        (js \ RESOLUTION).as[Int],
        (js \ TIMESTAMP).as[Long]))
  }
}