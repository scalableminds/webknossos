package com.scalableminds.webknossos.datastore.datareaders

import com.scalableminds.webknossos.datastore.models.datasource.AdditionalAxis
import play.api.libs.json.{Json, OFormat}

// Defines the axis order of a DatasetArray. Note that this ignores transpose codecs/ArrayOrder.F/C.
// Those will have to be applied on individual chunk’s contents.
case class AxisOrder(x: Int, y: Int, z: Option[Int], c: Option[Int] = None) {

  def hasZAxis: Boolean = z.isDefined

  def zWithFallback: Int = z match {
    case Some(value) => value
    // z is appended to the end of the array (this is reflected in DatasetArray adding 1 at the end of header datasetShape and chunkShape)
    case None => Math.max(Math.max(x, y), c.getOrElse(-1)) + 1
  }

  def wkToArrayPermutation(rank: Int): Array[Int] =
    c match {
      case Some(channel) =>
        ((0 until (rank - 4)).toList :+ channel :+ x :+ y :+ zWithFallback).toArray
      case None =>
        ((0 until (rank - 3)).toList :+ x :+ y :+ zWithFallback).toArray
    }

  def arrayToWkPermutation(rank: Int): Array[Int] = {
    val permutationMutable: Array[Int] = Array.fill(rank)(0)
    wkToArrayPermutation(rank).zipWithIndex.foreach {
      case (p, i) =>
        permutationMutable(p) = i
    }
    permutationMutable
  }

  def permuteIndicesWkToArray(indices: Array[Int]): Array[Int] =
    wkToArrayPermutation(indices.length).map(indices(_))

  def permuteIndicesArrayToWk(indices: Array[Int]): Array[Int] =
    arrayToWkPermutation(indices.length).map(indices(_))

  def length: Int = {
    val lengthOfZ = if (z.isDefined) 1 else 0
    val lengthOfC = if (c.isDefined) 1 else 0
    lengthOfC + 2 + lengthOfZ
  }
}

object AxisOrder {

  // assumes that the last three elements of the shape are z,y,x (standard in OME NGFF)
  def asZyxFromRank(rank: Int): AxisOrder = AxisOrder.xyz(rank - 1, rank - 2, rank - 3)

  def xyz(x: Int, y: Int, z: Int): AxisOrder = AxisOrder(x, y, Some(z))

  def xyz: AxisOrder = AxisOrder(0, 1, Some(2))

  // assumes that the last three elements of the shape are (c),x,y,z (which is what WEBKNOSSOS sends to the frontend)
  def asCxyzFromRank(rank: Int): AxisOrder =
    if (rank == 3)
      AxisOrder.xyz(rank - 3, rank - 2, rank - 1)
    else
      AxisOrder(rank - 3, rank - 2, Some(rank - 1), Some(rank - 4))

  def cxyz: AxisOrder = asCxyzFromRank(rank = 4)
  implicit val jsonFormat: OFormat[AxisOrder] = Json.format[AxisOrder]
}

case class Axis(name: String)

case class FullAxisOrder(axes: Seq[Axis])

object FullAxisOrder {
  def fromAxisOrderAndAdditionalAxes(axisOrder: AxisOrder,
                                     additionalAxes: Option[Seq[AdditionalAxis]]): FullAxisOrder = {
    val asArray: Array[Axis] = Array.fill(additionalAxes.map(_.length).getOrElse(0) + axisOrder.length)(Axis(""))
    asArray(axisOrder.x) = Axis("x")
    asArray(axisOrder.y) = Axis("y")
    axisOrder.c.foreach { c =>
      asArray(c) = Axis("c")
    }
    axisOrder.z.foreach { z =>
      asArray(z) = Axis("z")
    }
    for (additionalAxis <- additionalAxes.getOrElse(Seq.empty)) {
      asArray(additionalAxis.index) = Axis(additionalAxis.name)
    }
    FullAxisOrder(asArray.toVector)
  }
}
