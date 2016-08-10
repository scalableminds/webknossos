package oxalis.nml

import com.scalableminds.util.geometry.{Point3D, Vector3D}
import play.api.libs.json._
import com.scalableminds.util.xml.{SynchronousXMLWrites, XMLWrites}

case class Node(id: Int, position: Point3D, rotation: Vector3D = Node.defaultRotation, radius: Float = 120, viewport: Int = 1, resolution: Int = 1, bitDepth: Int = 0, interpolation: Boolean = false, timestamp: Long = System.currentTimeMillis, withSpeed: Double = -1)

object Node {
  val defaultRotation = Vector3D(0,0,0)

  implicit object NodeXMLWrites extends SynchronousXMLWrites[Node] {
    def synchronousWrites(n: Node) =
      <node id={ n.id.toString } radius={ n.radius.toString } x={ n.position.x.toString } y={ n.position.y.toString } z={ n.position.z.toString } rotX={ n.rotation.x.toString } rotY={ n.rotation.y.toString } rotZ={ n.rotation.z.toString } inVp={ n.viewport.toString } inMag={ n.resolution.toString } bitDepth={ n.bitDepth.toString } interpolation={ n.interpolation.toString } time={ n.timestamp.toString } withSpeed={ n.withSpeed.toString }/>
  }

  implicit object NodeFormat extends Format[Node] {
    val ID = "id"
    val RADIUS = "radius"
    val POSITION = "position"
    val ROTATION = "rotation"
    val VIEWPORT = "viewport"
    val RESOLUTION = "resolution"
    val TIMESTAMP = "timestamp"
    val INTERPOLATION = "interpolation"
    val BITDEPTH = "bitDepth"
    val WITHSPEED = "withSpeed"

    def writes(n: Node): JsObject = {
      Json.obj(
        ID -> n.id,
        RADIUS -> n.radius,
        POSITION -> n.position,
        ROTATION -> n.rotation,
        VIEWPORT -> n.viewport,
        RESOLUTION -> n.resolution,
        BITDEPTH -> n.bitDepth,
        INTERPOLATION -> n.interpolation,
        TIMESTAMP -> n.timestamp,
        WITHSPEED -> n.withSpeed
      )
    }

    def reads(js: JsValue) =
      JsSuccess(Node((js \ ID).as[Int],
        (js \ POSITION).as[Point3D],
        (js \ ROTATION).as[Vector3D],
        (js \ RADIUS).as[Float],
        (js \ VIEWPORT).as[Int],
        (js \ RESOLUTION).as[Int],
        (js \ BITDEPTH).as[Int],
        (js \ INTERPOLATION).as[Boolean],
        (js \ TIMESTAMP).as[Long],
        (js \ WITHSPEED).asOpt[Double].getOrElse(-1)))
  }
}
