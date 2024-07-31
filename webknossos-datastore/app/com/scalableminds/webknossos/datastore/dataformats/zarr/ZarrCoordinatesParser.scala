package com.scalableminds.webknossos.datastore.dataformats.zarr

object ZarrCoordinatesParser {
  def parseDotCoordinates(
      cxyz: String,
  ): Option[(Int, Int, Int, Int)] = {
    val singleRx = "^\\s*c\\.([0-9]+)\\.([0-9]+)\\.([0-9]+)\\.([0-9]+)\\s*$".r

    cxyz match {
      case singleRx(c, x, y, z) =>
        Some(Integer.parseInt(c), Integer.parseInt(x), Integer.parseInt(y), Integer.parseInt(z))
      case _ => None
    }
  }

  def parseNDimensionalDotCoordinates(
      coordinates: String,
  ): Option[Array[Int]] = {
    val ndCoordinatesRx = "^\\s*c\\.([0-9]+)\\.([0-9]+)\\.([0-9]+)(\\.([0-9]+))+\\s*$".r
    // The tail cuts of the leading "c" form the "c." at the beginning of coordinates.
    ndCoordinatesRx.findFirstIn(coordinates).map(m => m.split('.').tail.map(coord => Integer.parseInt(coord)))
  }
}
