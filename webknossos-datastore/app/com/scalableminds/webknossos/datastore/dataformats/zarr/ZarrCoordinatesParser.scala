package com.scalableminds.webknossos.datastore.dataformats.zarr

import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.{bool2Fox, option2Fox}
import com.scalableminds.webknossos.datastore.models.AdditionalCoordinate
import play.api.http.Status.NOT_FOUND
import play.api.i18n.{Messages, MessagesProvider}

import scala.concurrent.ExecutionContext

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
  )(implicit ec: ExecutionContext, m: MessagesProvider): Fox[(Int, Int, Int, Option[List[AdditionalCoordinate]])] = {
    val ndCoordinatesRx = "^\\s*c\\.([0-9]+)\\.([0-9]+)\\.([0-9]+)(\\.([0-9]+))+\\s*$".r
    // The tail cuts off the leading "c" form the "c." at the beginning of coordinates.

    for {
      parsedCoordinates <- ndCoordinatesRx
        .findFirstIn(coordinates)
        .map(m => m.split('.').tail.map(coord => Integer.parseInt(coord))) ?~>
        Messages("zarr.invalidChunkCoordinates") ~> NOT_FOUND
      channelCoordinate <- parsedCoordinates.headOption ~> NOT_FOUND
      _ <- bool2Fox(channelCoordinate == 0) ?~> "zarr.invalidFirstChunkCoord" ~> NOT_FOUND
      _ <- bool2Fox(parsedCoordinates.length >= 4) ?~> "zarr.notEnoughCoordinates" ~> NOT_FOUND
      (x, y, z) = (parsedCoordinates(parsedCoordinates.length - 3),
                   parsedCoordinates(parsedCoordinates.length - 2),
                   parsedCoordinates(parsedCoordinates.length - 1))
      additionalCoordinates = if (parsedCoordinates.length > 4)
        Some(
          parsedCoordinates
            .slice(1, parsedCoordinates.length - 3)
            .zipWithIndex
            .map(coordWithIndex => new AdditionalCoordinate(name = s"t${coordWithIndex._2}", value = coordWithIndex._1))
            .toList)
      else None
    } yield (x, y, z, additionalCoordinates)
  }
}
