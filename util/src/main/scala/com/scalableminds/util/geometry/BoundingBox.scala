package com.scalableminds.util.geometry

import com.scalableminds.util.tools.Math.ceilDiv
import com.scalableminds.util.tools.Full
import play.api.libs.json.{JsObject, Json}

case class BoundingBox(topLeft: Vec3Int, width: Int, height: Int, depth: Int) {

  val bottomRight: Vec3Int = topLeft.move(width, height, depth)

  def intersects(other: BoundingBox): Boolean =
    math.max(topLeft.x, other.topLeft.x) < math.min(bottomRight.x, other.bottomRight.x) &&
      math.max(topLeft.y, other.topLeft.y) < math.min(bottomRight.y, other.bottomRight.y) &&
      math.max(topLeft.z, other.topLeft.z) < math.min(bottomRight.z, other.bottomRight.z)

  def intersection(other: BoundingBox): Option[BoundingBox] = {
    val newTopLeft = Vec3Int(
      math.max(topLeft.x, other.topLeft.x),
      math.max(topLeft.y, other.topLeft.y),
      math.max(topLeft.z, other.topLeft.z)
    )
    val newBottomRight = Vec3Int(
      math.min(bottomRight.x, other.bottomRight.x),
      math.min(bottomRight.y, other.bottomRight.y),
      math.min(bottomRight.z, other.bottomRight.z)
    )
    if (newTopLeft.x < newBottomRight.x && newTopLeft.y < newBottomRight.y && newTopLeft.z < newBottomRight.z) {
      Some(
        BoundingBox(newTopLeft,
                    newBottomRight.x - newTopLeft.x,
                    newBottomRight.y - newTopLeft.y,
                    newBottomRight.z - newTopLeft.z))
    } else None
  }

  def union(other: BoundingBox): BoundingBox = {
    val x = math.min(other.topLeft.x, topLeft.x)
    val y = math.min(other.topLeft.y, topLeft.y)
    val z = math.min(other.topLeft.z, topLeft.z)

    val w = math.max(other.bottomRight.x, bottomRight.x) - x
    val h = math.max(other.bottomRight.y, bottomRight.y) - y
    val d = math.max(other.bottomRight.z, bottomRight.z) - z

    BoundingBox(Vec3Int(x, y, z), w, h, d)
  }

  def isEmpty: Boolean =
    width <= 0 || height <= 0 || depth <= 0

  def center: Vec3Int =
    topLeft.move(bottomRight).scale(0.5f)

  def scale(s: Float): BoundingBox =
    BoundingBox(topLeft.scale(s), (width * s).toInt, (height * s).toInt, (depth * s).toInt)

  def *(that: Vec3Int): BoundingBox =
    BoundingBox(topLeft * that, width * that.x, height * that.y, depth * that.z)

  def /(that: Vec3Int): BoundingBox =
    // Since floorDiv is used for topLeft, ceilDiv is used for the size to avoid voxels being lost at the border
    BoundingBox(topLeft / that, ceilDiv(width, that.x), ceilDiv(height, that.y), ceilDiv(depth, that.z))

  def toSql: List[Int] =
    List(topLeft.x, topLeft.y, topLeft.z, width, height, depth)

  def volume: Long =
    width.toLong * height.toLong * depth.toLong

  def size: Vec3Int =
    Vec3Int(width, height, depth)

  def toLiteral: String = f"${topLeft.x},${topLeft.y},${topLeft.z},$width,$height,$depth"

  def toWkLibsJson: JsObject =
    Json.obj("topLeft" -> topLeft, "width" -> width, "height" -> height, "depth" -> depth)
}

object BoundingBox {

  import play.api.libs.json._

  private val literalPattern =
    "\\s*((?:\\-)?[0-9]+),\\s*((?:\\-)?[0-9]+),\\s*((?:\\-)?[0-9]+)\\s*,\\s*([0-9]+),\\s*([0-9]+),\\s*([0-9]+)\\s*".r

  def empty: BoundingBox =
    BoundingBox(Vec3Int.zeros, 0, 0, 0)

  def fromLiteral(s: String): Option[BoundingBox] =
    s match {
      case literalPattern(minX, minY, minZ, width, height, depth) =>
        try {
          Full(
            BoundingBox(
              Vec3Int(Integer.parseInt(minX), Integer.parseInt(minY), Integer.parseInt(minZ)),
              Integer.parseInt(width),
              Integer.parseInt(height),
              Integer.parseInt(depth)
            ))
        } catch {
          case _: NumberFormatException => None
        }
      case _ =>
        None
    }

  def fromSQL(ints: List[Int]): Option[BoundingBox] =
    if (ints.length == 6)
      Some(BoundingBox(Vec3Int(ints(0), ints(1), ints(2)), ints(3), ints(4), ints(5)))
    else
      None

  def union(bbs: List[BoundingBox]): BoundingBox =
    bbs match {
      case head :: tail =>
        tail.foldLeft(head)(_ `union` _)
      case _ =>
        BoundingBox.empty
    }

  def intersection(bbs: List[BoundingBox]): Option[BoundingBox] =
    bbs match {
      case head :: tail =>
        tail.foldLeft[Option[BoundingBox]](Some(head)) { (aOpt, b) =>
          aOpt.flatMap(_ `intersection` b)
        }
      case _ =>
        None
    }

  def fromTopLeftAndSize(topLeft: Array[Int], size: Array[Int]): Option[BoundingBox] =
    (size.length, Vec3Int.fromArray(topLeft)) match {
      case (3, Some(t)) => Some(BoundingBox(t, size(0), size(1), size(2)))
      case _            => None
    }

  implicit val jsonFormat: OFormat[BoundingBox] = Json.format[BoundingBox]
}
