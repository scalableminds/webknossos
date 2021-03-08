package com.scalableminds.util.geometry

import net.liftweb.common.{Box, Empty, Full}

case class BoundingBox(topLeft: Point3D, width: Int, height: Int, depth: Int) {

  val bottomRight: Point3D = topLeft.move(width, height, depth)

  def intersects(other: BoundingBox): Boolean =
    math.max(topLeft.x, other.topLeft.x) < math.min(bottomRight.x, other.bottomRight.x) &&
      math.max(topLeft.y, other.topLeft.y) < math.min(bottomRight.y, other.bottomRight.y) &&
      math.max(topLeft.z, other.topLeft.z) < math.min(bottomRight.z, other.bottomRight.z)

  def combineWith(other: BoundingBox): BoundingBox = {
    val x = math.min(other.topLeft.x, topLeft.x)
    val y = math.min(other.topLeft.y, topLeft.y)
    val z = math.min(other.topLeft.z, topLeft.z)

    val w = math.max(other.bottomRight.x, bottomRight.x) - x
    val h = math.max(other.bottomRight.y, bottomRight.y) - y
    val d = math.max(other.bottomRight.z, bottomRight.z) - z

    BoundingBox(Point3D(x, y, z), w, h, d)
  }

  def isEmpty: Boolean =
    width <= 0 || height <= 0 || depth <= 0

  def center: Point3D =
    topLeft.move(bottomRight).scale(0.5f)

  def scale(s: Float): BoundingBox =
    BoundingBox(topLeft.scale(s), (width * s).toInt, (height * s).toInt, (depth * s).toInt)

  def toSql =
    List(topLeft.x, topLeft.y, topLeft.z, width, height, depth)

  def volume: Long =
    width.toLong * height.toLong * depth.toLong

  def dimensions: Point3D =
    Point3D(width, height, depth)

}

object BoundingBox {

  import play.api.libs.json._

  private val formRx = "\\s*([0-9]+),\\s*([0-9]+),\\s*([0-9]+)\\s*,\\s*([0-9]+),\\s*([0-9]+),\\s*([0-9]+)\\s*".r

  def empty: BoundingBox =
    BoundingBox(Point3D(0, 0, 0), 0, 0, 0)

  def createFrom(s: String): Box[BoundingBox] =
    s match {
      case formRx(minX, minY, minZ, width, height, depth) =>
        try {
          Full(
            BoundingBox(
              Point3D(Integer.parseInt(minX), Integer.parseInt(minY), Integer.parseInt(minZ)),
              Integer.parseInt(width),
              Integer.parseInt(height),
              Integer.parseInt(depth)
            ))
        } catch {
          case _: NumberFormatException => Empty
        }
      case _ =>
        Empty
    }

  def combine(bbs: List[BoundingBox]): BoundingBox =
    bbs match {
      case head :: tail =>
        tail.foldLeft(head)(_ combineWith _)
      case _ =>
        BoundingBox(Point3D(0, 0, 0), 0, 0, 0)
    }

  def createFrom(bbox: List[List[Int]]): Box[BoundingBox] =
    if (bbox.size < 3 || bbox(0).size < 2 || bbox(1).size < 2 || bbox(2).size < 2)
      Empty
    else
      Full(
        BoundingBox(Point3D(bbox(0)(0), bbox(1)(0), bbox(2)(0)),
                    bbox(0)(1) - bbox(0)(0),
                    bbox(1)(1) - bbox(1)(0),
                    bbox(2)(1) - bbox(2)(0)))

  def createFrom(topLeft: Point3D, bottomRight: Point3D): Box[BoundingBox] =
    if (topLeft <= bottomRight)
      Full(BoundingBox(topLeft, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y, bottomRight.z - topLeft.z))
    else
      Empty

  def fromSQL(ints: List[Int]): Option[BoundingBox] =
    if (ints.length == 6)
      Some(BoundingBox(Point3D(ints(0), ints(1), ints(2)), ints(3), ints(4), ints(5)))
    else
      None

  implicit val boundingBoxFormat: OFormat[BoundingBox] = Json.format[BoundingBox]
}
