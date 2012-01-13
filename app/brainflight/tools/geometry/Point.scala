package brainflight.tools.geometry

import play.api.libs.json._
import play.api.libs.json.Writes._

/**
 * scalableminds - brainflight
 * User: tmbo
 * Date: 20.12.11
 * Time: 12:22
 */

case class Point3D(x: Int, y:Int, z:Int)

object Point3D{
  implicit object Point3DReads extends Reads[Point3D] {
    def reads(json: JsValue) = json match {
      case JsArray(ts) if ts.size==3 =>
        val c = ts.map(fromJson[Int](_))
        Point3D(c(0),c(1),c(2))
      case _ => throw new RuntimeException("List expected")
    }
  }
  implicit object Point3DWrites extends Writes[Point3D] {
    def writes(v: Point3D) = {
      val l = List(v.x, v.y, v.z)
      JsArray(l.map(toJson(_)))
    }
  }
}