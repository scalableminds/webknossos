package com.scalableminds.webknossos.datastore.dataformats.zarr

import com.scalableminds.webknossos.datastore.dataformats.MagLocator
import com.scalableminds.webknossos.datastore.datareaders.AxisOrder
import com.scalableminds.webknossos.datastore.helpers.UPath
import com.scalableminds.webknossos.datastore.models.datasource.*

import java.nio.file.Path

trait Zarr3OutputHelper {

  protected def reorderAdditionalAxes(additionalAxes: Seq[AdditionalAxis]): Seq[AdditionalAxis] = {
    val additionalAxesStartIndex = 1 // channel comes first
    val sorted = additionalAxes.sortBy(_.index)
    sorted.zipWithIndex.map { case (axis, index) =>
      axis.copy(index = index + additionalAxesStartIndex)
    }
  }

  /** Converts a data layer to a StaticLayer with an on-the-fly generated Zarr representation. Note that zarrVersion is
    * only about the outbound (HTTP-served) representation here, it is independent of the layer's actual underlying
    * storage format.
    */
  protected def convertLayerToZarrLayer(layer: DataLayer, zarrVersion: Int): StaticLayer = {
    val dataFormat = if (zarrVersion == 2) DataFormat.zarr else DataFormat.zarr3
    layer match {
      case s: SegmentationLayer =>
        val rank = s.additionalAxes.map(_.length).getOrElse(0) + 4 // We’re writing c, additionalAxes, xyz
        StaticSegmentationLayer(
          s.name,
          dataFormat,
          s.boundingBox,
          s.elementClass,
          mags = s.sortedMags.map(m =>
            MagLocator(
              m,
              Some(UPath.fromLocalPath(Path.of(s"./${s.name}/${m.toMagLiteral(allowScalar = true)}"))),
              None,
              Some(AxisOrder.cAdditionalxyz(rank)),
              None,
              None
            )
          ),
          mappings = s.mappings,
          largestSegmentId = s.largestSegmentId,
          defaultViewConfiguration = s.defaultViewConfiguration,
          adminViewConfiguration = s.adminViewConfiguration,
          coordinateTransformations = s.coordinateTransformations,
          additionalAxes = s.additionalAxes.map(reorderAdditionalAxes)
        )
      case d: DataLayer =>
        val rank = d.additionalAxes.map(_.length).getOrElse(0) + 4 // We’re writing c, additionalAxes, xyz
        StaticColorLayer(
          d.name,
          dataFormat,
          d.boundingBox,
          d.elementClass,
          mags = d.sortedMags.map(m =>
            MagLocator(
              m,
              Some(UPath.fromLocalPath(Path.of(s"./${d.name}/${m.toMagLiteral(allowScalar = true)}"))),
              None,
              Some(AxisOrder.cAdditionalxyz(rank)),
              None,
              None
            )
          ),
          defaultViewConfiguration = d.defaultViewConfiguration,
          adminViewConfiguration = d.adminViewConfiguration,
          coordinateTransformations = d.coordinateTransformations,
          additionalAxes = d.additionalAxes.map(reorderAdditionalAxes)
        )
    }
  }

}
