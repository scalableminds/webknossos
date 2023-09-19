package com.scalableminds.webknossos.datastore.datareaders

import play.api.libs.json.{JsNumber, JsObject, JsResult, JsValue, Json, OFormat, Reads, Writes}

sealed abstract class AxisOrder() {
  def x: Int
  def y: Int
  def z: Int

  def c: Option[Int]

  def permutation(rank: Int): Array[Int] =
    c match {
      case Some(channel) =>
        ((0 until (rank - 4)).toList :+ channel :+ x :+ y :+ z).toArray
      case None =>
        ((0 until (rank - 3)).toList :+ x :+ y :+ z).toArray
    }

  def inversePermutation(rank: Int): Array[Int] = {
    val permutationMutable: Array[Int] = Array.fill(rank)(0)
    permutation(rank).zipWithIndex.foreach {
      case (p, i) =>
        permutationMutable(p) = i
    }
    permutationMutable
  }

  def permuteIndices(indices: Array[Int]): Array[Int] =
    permutation(indices.length).map(indices(_))

  def permuteIndicesReverse(indices: Array[Int]): Array[Int] =
    inversePermutation(indices.length).map(indices(_))

  def hasZAxis: Boolean = z >= 0
}

object AxisOrder {
  implicit object AxisOrderReads extends Reads[AxisOrder] {
    def reads(json: JsValue): JsResult[AxisOrder] = json match {
      case JsObject(obj) => {
        obj get "z" match {
          case Some(z_str) =>
            for {
              x_value <- obj.getOrElse("x", JsNumber(0)).validate[Int]
              y_value <- obj.getOrElse("y", JsNumber(0)).validate[Int]
              z_value <- z_str.validate[Int]
              c_value = (obj get "c").map(_.validate[Int].getOrElse(0))
            } yield AxisOrder3D(x_value, y_value, z_value, c_value)
          case None =>
            for {
              x_value <- obj.getOrElse("x", JsNumber(0)).validate[Int]
              y_value <- obj.getOrElse("y", JsNumber(0)).validate[Int]
              c_value = (obj get "c").map(_.validate[Int].getOrElse(0))
            } yield AxisOrder2D(x_value, y_value, c_value)
        }
      }
    }
  }

  implicit object AxisOrderWrites extends Writes[AxisOrder] {
    def writes(v: AxisOrder): JsObject = {
      val cOpt = v.c match {
        case Some(channel) => Some("c", JsNumber(channel))
        case None          => None
      }
      v match {
        case AxisOrder3D(x, y, z, c, t) =>
          JsObject(Seq(("x", JsNumber(x)), ("y", JsNumber(y)), ("z", JsNumber(z))) ++ cOpt)
        case AxisOrder2D(x, y, c) => JsObject(Seq(("x", JsNumber(x)), ("y", JsNumber(y))) ++ cOpt)
      }
    }
  }
}

case class AxisOrder3D(override val x: Int,
                       override val y: Int,
                       override val z: Int,
                       override val c: Option[Int] = None,
                       t: Option[Int] = None)
    extends AxisOrder

object AxisOrder3D {
  // assumes that the last three elements of the shape are z,y,x (standard in OME NGFF)
  def asZyxFromRank(rank: Int): AxisOrder3D = AxisOrder3D(rank - 1, rank - 2, rank - 3)

  def cxyz: AxisOrder3D = asCxyzFromRank(rank = 4)

  // assumes that the last three elements of the shape are (c),x,y,z (which is what webKnossos sends to the frontend)
  def asCxyzFromRank(rank: Int): AxisOrder3D =
    if (rank == 3)
      AxisOrder3D(rank - 3, rank - 2, rank - 1)
    else
      AxisOrder3D(rank - 3, rank - 2, rank - 1, Some(rank - 4))

  implicit val jsonFormat: OFormat[AxisOrder3D] = Json.format[AxisOrder3D]
}

case class AxisOrder2D(override val x: Int, override val y: Int, override val c: Option[Int] = None) extends AxisOrder {
  override def permutation(rank: Int): Array[Int] =
    c match {
      case Some(channel) =>
        ((0 until (rank - 3)).toList :+ channel :+ x :+ y).toArray
      case None =>
        ((0 until (rank - 2)).toList :+ x :+ y).toArray
    }

  override def z: Int = -1
}

object AxisOrder2D {
  implicit val jsonFormat: OFormat[AxisOrder2D] = Json.format[AxisOrder2D]
}
