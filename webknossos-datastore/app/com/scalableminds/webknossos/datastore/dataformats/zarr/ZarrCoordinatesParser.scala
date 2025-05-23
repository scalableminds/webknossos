package com.scalableminds.webknossos.datastore.dataformats.zarr

import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.models.AdditionalCoordinate
import com.scalableminds.webknossos.datastore.models.datasource.AdditionalAxis
import play.api.http.Status.NOT_FOUND
import play.api.i18n.{Messages, MessagesProvider}

import scala.concurrent.ExecutionContext

object ZarrCoordinatesParser extends FoxImplicits {

  def parseNDimensionalDotCoordinates(
      coordinates: String,
      reorderedAdditionalAxesOpt: Option[Seq[AdditionalAxis]]
  )(implicit ec: ExecutionContext, m: MessagesProvider): Fox[(Int, Int, Int, Option[List[AdditionalCoordinate]])] = {
    val ndCoordinatesRx = "^\\s*([0-9]+)\\.([0-9]+)\\.([0-9]+)(\\.([0-9]+))+\\s*$".r

    for {
      parsedCoordinates <- ndCoordinatesRx
        .findFirstIn(coordinates)
        .map(m => m.split('.').map(coord => Integer.parseInt(coord)))
        .toFox ?~>
        Messages("zarr.invalidChunkCoordinates") ~> NOT_FOUND
      channelCoordinate <- parsedCoordinates.headOption.toFox ~> NOT_FOUND
      _ <- Fox.fromBool(channelCoordinate == 0) ?~> "zarr.invalidFirstChunkCoord" ~> NOT_FOUND
      _ <- Fox.fromBool(parsedCoordinates.length >= 4) ?~> "zarr.notEnoughCoordinates" ~> NOT_FOUND
      (x, y, z) = (parsedCoordinates(parsedCoordinates.length - 3),
                   parsedCoordinates(parsedCoordinates.length - 2),
                   parsedCoordinates(parsedCoordinates.length - 1))
      reorderedAdditionalAxes = reorderedAdditionalAxesOpt.getOrElse(List.empty)
      _ <- Fox.fromBool(reorderedAdditionalAxes.length == parsedCoordinates.length - 4) ?~> "zarr.invalidAdditionalCoordinates" ~> NOT_FOUND
      requestContainsAdditionalCoordinates = parsedCoordinates.length > 4
      additionalCoordinates = if (requestContainsAdditionalCoordinates)
        Some(
          parsedCoordinates
            .slice(1, parsedCoordinates.length - 3)
            .zipWithIndex
            .map({
              case (coordinate, index) =>
                new AdditionalCoordinate(name = reorderedAdditionalAxes(index).name, value = coordinate)
            })
            .toList)
      else None
    } yield (x, y, z, additionalCoordinates)
  }
}
