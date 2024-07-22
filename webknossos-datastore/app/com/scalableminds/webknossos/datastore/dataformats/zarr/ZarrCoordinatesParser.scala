package com.scalableminds.webknossos.datastore.dataformats.zarr

object ZarrCoordinatesParser {
  def parseDotCoordinates(
      cxyz: String,
  ): Option[(Int, Int, Int, Int)] = {
    val singleRx = "\\s*([0-9]+).([0-9]+).([0-9]+).([0-9]+)\\s*".r

    cxyz match {
      case singleRx(c, x, y, z) =>
        Some(Integer.parseInt(c), Integer.parseInt(x), Integer.parseInt(y), Integer.parseInt(z))
      case _ => None
    }
  }

  def parseNDimensionalDotCoordinates(
                           coordinates: String,
                         ): Option[Array[Int]] = {
    val ndCoordinatesRx = "\\s*([0-9]+).([0-9]+).([0-9]+)(.([0-9]+))+\\s*".r

    coordinates match {
      case ndCoordinatesRx(coordString) =>
        Some(coordString.split('.').map(coord => Integer.parseInt(coord)))
      case _ => None
    }
  }
}
