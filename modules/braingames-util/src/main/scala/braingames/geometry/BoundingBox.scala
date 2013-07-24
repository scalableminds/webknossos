package braingames.geometry

case class BoundingBox(topLeft: Point3D, width: Int, height: Int, depth: Int) {

  val bottomRight = topLeft.move(width, height, depth)

  def contains(p: Point3D) = {
    p.x >= topLeft.x && p.y >= topLeft.y && p.z >= topLeft.z &&
      p.x <= bottomRight.x && p.y <= bottomRight.y && p.z <= bottomRight.z

  }
}

object BoundingBox extends Function4[Point3D, Int, Int, Int, BoundingBox]{
  import play.api.libs.json._
  import play.api.libs.functional.syntax._

  def hull(c: List[BoundingBox]) = {
    if (c.isEmpty)
      BoundingBox(Point3D(0, 0, 0), 0, 0, 0)
    else {
      val topLeft = c.map(_.topLeft).foldLeft(Point3D(0, 0, 0))((b, e) => (
        Point3D(math.max(b.x, e.x), math.max(b.y, e.y), math.max(b.z, e.z))))

      BoundingBox(
        topLeft,
        c.map(_.width).max,
        c.map(_.height).max,
        c.map(_.depth).max)
    }
  }

  def createFrom(bbox: List[List[Int]]) = {
    if (bbox.size < 3 || bbox(0).size < 2 || bbox(1).size < 2 || bbox(2).size < 2)
      throw new Exception("Invalid bbox")
    BoundingBox(
      Point3D(bbox(0)(0), bbox(1)(0), bbox(2)(0)),
      bbox(0)(1) - bbox(0)(0),
      bbox(1)(1) - bbox(1)(0),
      bbox(2)(1) - bbox(2)(0))
  }

  def createFrom(width: Int, height: Int, deph: Int, topLeft: Point3D): BoundingBox =
    BoundingBox(topLeft, width, height, deph)

  implicit val boundingBoxFormat = Json.format[BoundingBox]
}