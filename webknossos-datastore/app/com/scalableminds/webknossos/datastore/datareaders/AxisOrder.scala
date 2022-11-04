package com.scalableminds.webknossos.datastore.datareaders

import play.api.libs.json.{Json, OFormat}

case class AxisOrder(x: Int, y: Int, z: Int, c: Option[Int] = None, t: Option[Int] = None) {
  def permutation(rank: Int): Array[Int] = {
    c match {
      case Some(channel) =>
        ((0 until (rank - 4)).toList :+ channel :+ x :+ y :+ z).toArray
      case None =>
        ((0 until (rank - 3)).toList :+ x :+ y :+ z).toArray
    }

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

}

object AxisOrder {
  // assumes that the last three elements of the shape are z,y,x (standard in OME NGFF)
  def asZyxFromRank(rank: Int): AxisOrder = AxisOrder(rank - 1, rank - 2, rank - 3)

  def cxyz: AxisOrder = asCxyzFromRank(rank = 4)

  // assumes that the last three elements of the shapre are (c),x,y,z (which is what webKnossos sends to the frontend)
  def asCxyzFromRank(rank: Int): AxisOrder =
    if (rank == 3)
      AxisOrder(rank - 3, rank - 2, rank - 1)
    else
      AxisOrder(rank - 3, rank - 2, rank - 1, Some(rank - 4))

  implicit val jsonFormat: OFormat[AxisOrder] = Json.format[AxisOrder]
}
