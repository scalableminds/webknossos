package com.scalableminds.webknossos.datastore.dataformats.zarr

import com.scalableminds.util.tools.Box.tryo
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.models.AdditionalCoordinate
import com.scalableminds.webknossos.datastore.models.datasource.AdditionalAxis

import scala.concurrent.ExecutionContext

object ZarrCoordinatesParser extends FoxImplicits {

  def parseNDimensionalDotCoordinates(
      coordinates: String,
      reorderedAdditionalAxesOpt: Option[Seq[AdditionalAxis]]
  )(implicit ec: ExecutionContext): Fox[(Int, Int, Int, Option[List[AdditionalCoordinate]])] =
    for {
      split <- tryo(coordinates.split('.')).toFox
      ints <- Fox.serialCombined(split)(intLiteral => tryo(Integer.parseInt(intLiteral)).toFox)
      channelCoordinate <- ints.headOption.toFox
      _ <- Fox.fromBool(channelCoordinate == 0) ?~> "zarr.invalidFirstChunkCoord"
      _ <- Fox.fromBool(ints.length >= 4) ?~> "zarr.notEnoughCoordinates"
      (x, y, z) = (ints(ints.length - 3), ints(ints.length - 2), ints.last)
      reorderedAdditionalAxes = reorderedAdditionalAxesOpt.getOrElse(List.empty)
      _ <- Fox.fromBool(reorderedAdditionalAxes.length == ints.length - 4) ?~> "zarr.invalidAdditionalCoordinates"
      requestContainsAdditionalCoordinates = ints.length > 4
      additionalCoordinates = if (requestContainsAdditionalCoordinates)
        Some(ints.slice(1, ints.length - 3).zipWithIndex.map {
          case (coordinate, index) =>
            new AdditionalCoordinate(name = reorderedAdditionalAxes(index).name, value = coordinate)
        })
      else None
    } yield (x, y, z, additionalCoordinates)
}
