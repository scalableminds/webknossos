package com.scalableminds.webknossos.datastore.jzarr

case class AxisOrder(x: Int, y: Int, z: Int)

object AxisOrder {
  // assumes that the last three elements of the shapre are z,y,x (standard in OME NGFF)
  def guessFromRank(rank: Int): AxisOrder = AxisOrder(rank - 1, rank - 2, rank - 3)
}
