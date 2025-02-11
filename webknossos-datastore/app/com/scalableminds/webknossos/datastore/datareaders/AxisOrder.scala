package com.scalableminds.webknossos.datastore.datareaders

import com.scalableminds.webknossos.datastore.models.datasource.AdditionalAxis
import play.api.libs.json.{JsValue, Json, OFormat}

// Defines the axis order of a DatasetArray. Note that this ignores transpose codecs/ArrayOrder.F/C.
// Those will have to be applied on individual chunk’s contents.
case class AxisOrder(x: Int, y: Int, z: Option[Int], c: Option[Int] = None) {

  def hasZAxis: Boolean = z.isDefined

  def zWithFallback: Int = z match {
    case Some(value) => value
    // z is appended to the end of the array (this is reflected in DatasetArray adding 1 at the end of header datasetShape and chunkShape)
    case None => Math.max(Math.max(x, y), c.getOrElse(-1)) + 1
  }

  def length: Int = {
    val lengthOfZ = 1 // if z is None, we append it as an adapter
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

  // Additional coordinates are inserted between c and xyz
  def cAdditionalxyz(rank: Int): AxisOrder = AxisOrder(c = Some(0), x = rank - 3, y = rank - 2, z = Some(rank - 1))
  implicit val jsonFormat: OFormat[AxisOrder] = Json.format[AxisOrder]
}

case class Axis(name: String)

// Constructed from AxisOrder and AdditionalAxes. Always contains the full rank (plus 1 for z in 2d adapter case).
case class FullAxisOrder(axes: Seq[Axis]) {

  override def toString: String = axes.map(_.name).mkString("")
  def toStringWk: String =
    axesWk.map(_.name).mkString("")

  def axesWk: Array[Axis] = arrayToWkPermutation.map(axes)

  lazy val rank: Int = axes.length

  lazy val arrayToWkPermutation: Array[Int] = {
    // wk is always the additionalAxes + (c)xyz
    val permutationMutable: Array[Int] = Array.fill(axes.length)(0)

    var additionalAxisIndex = 0
    axes.zipWithIndex.foreach { case (axis, index) =>
      axis.name match {
        case "z" => permutationMutable(rank - 1) = index
        case "y" => permutationMutable(rank - 2) = index
        case "x" => permutationMutable(rank - 3) = index
        case "c" => permutationMutable(rank - 4) = index
        case _ =>
          permutationMutable(additionalAxisIndex) = index
          additionalAxisIndex += 1
      }
    }
    permutationMutable
  }

  lazy val arrayFToWkFPermutation: Array[Int] = arrayToWkPermutation.reverse.map(elem => rank - 1 - elem)
  lazy val arrayCToWkFPermutation: Array[Int] = arrayToWkPermutation.reverse

  private lazy val wkToArrayPermutation: Array[Int] = {
    val permutationMutable: Array[Int] = Array.fill(arrayToWkPermutation.length)(0)
    arrayToWkPermutation.zipWithIndex.foreach { case (p, i) =>
      permutationMutable(p) = i
    }
    permutationMutable
  }

  def permuteIndicesWkToArray(indices: Array[Int]): Array[Int] =
    wkToArrayPermutation.map(indices(_))

  def permuteIndicesArrayToWk(indices: Array[Int]): Array[Int] =
    arrayToWkPermutation.map(indices(_))

  def toWkLibsJson: JsValue =
    Json.toJson(axes.zipWithIndex.collect {
      case (axis, index) if axis.name == "x" || axis.name == "y" || axis.name == "z" =>
        axis.name -> index
    }.toMap)

}

object FullAxisOrder {

  def fromAxisOrderAndAdditionalAxes(
      rank: Int,
      axisOrder: AxisOrder,
      additionalAxes: Option[Seq[AdditionalAxis]]
  ): FullAxisOrder = {
    val asArray: Array[Axis] = Array.fill(rank)(Axis(""))
    asArray(axisOrder.x) = Axis("x")
    asArray(axisOrder.y) = Axis("y")
    axisOrder.c.foreach { c =>
      asArray(c) = Axis("c")
    }
    axisOrder.z.foreach { z =>
      asArray(z) = Axis("z")
    }
    if (!axisOrder.hasZAxis) {
      asArray(asArray.length - 1) = Axis("z") // Adapter for reading 2D datasets
    }
    for (additionalAxis <- additionalAxes.getOrElse(Seq.empty))
      asArray(additionalAxis.index) = Axis(additionalAxis.name)
    FullAxisOrder(asArray.toVector)
  }

}
