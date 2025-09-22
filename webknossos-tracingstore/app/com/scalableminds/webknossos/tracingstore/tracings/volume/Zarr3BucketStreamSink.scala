package com.scalableminds.webknossos.tracingstore.tracings.volume

import com.scalableminds.util.geometry.{Vec3Double, Vec3Int}
import com.scalableminds.util.io.{NamedFunctionStream, NamedStream}
import com.scalableminds.util.tools.{ByteUtils, Fox}
import com.scalableminds.webknossos.datastore.dataformats.MagLocator
import com.scalableminds.webknossos.datastore.dataformats.zarr.Zarr3OutputHelper
import com.scalableminds.webknossos.datastore.datareaders.zarr3._
import com.scalableminds.webknossos.datastore.datareaders.AxisOrder
import com.scalableminds.webknossos.datastore.helpers.{ProtoGeometryImplicits, UPath}
import com.scalableminds.webknossos.datastore.models.datasource.{
  AdditionalAxis,
  DataFormat,
  DataSourceId,
  StaticSegmentationLayer,
  UsableDataSource
}
import com.scalableminds.webknossos.datastore.models.{AdditionalCoordinate, BucketPosition, VoxelSize}

import scala.concurrent.ExecutionContext

// Creates data zip from volume tracings
class Zarr3BucketStreamSink(val layer: VolumeTracingLayer, tracingHasFallbackLayer: Boolean)
    extends ProtoGeometryImplicits
    with ReversionHelper
    with Zarr3OutputHelper
    with ByteUtils {

  private lazy val defaultLayerName = "volumeAnnotationData"
  private lazy val dimensionSeparator = "."

  private lazy val rank = layer.additionalAxes.getOrElse(Seq.empty).length + 4
  private lazy val additionalAxesSorted = reorderAdditionalAxes(layer.additionalAxes.getOrElse(Seq.empty))

  def apply(bucketStream: Iterator[(BucketPosition, Array[Byte])], mags: Seq[Vec3Int], voxelSize: Option[VoxelSize])(
      implicit ec: ExecutionContext): Iterator[NamedStream] = {

    val header = Zarr3ArrayHeader.fromDataLayer(layer,
                                                mags.headOption.getOrElse(Vec3Int.ones),
                                                additionalCodecs = Seq(BloscCodecConfiguration.defaultForWKZarrOutput))
    bucketStream.flatMap {
      case (bucket, data) =>
        val skipBucket = if (tracingHasFallbackLayer) isAllZero(data) else isRevertedElement(data)
        if (skipBucket) {
          // If the tracing has no fallback segmentation, all-zero buckets can be omitted entirely
          None
        } else {
          val filePath = zarrChunkFilePath(defaultLayerName, bucket, additionalAxesSorted)
          Some(
            NamedFunctionStream(
              filePath,
              os => Fox.successful(os.write(compressor.compress(data)))
            )
          )
        }
      case _ => None
    } ++ mags.map { mag =>
      NamedFunctionStream.fromJsonSerializable(zarrHeaderFilePath(defaultLayerName, mag), header)
    } ++ Seq(
      NamedFunctionStream.fromJsonSerializable(
        UsableDataSource.FILENAME_DATASOURCE_PROPERTIES_JSON,
        createVolumeDataSource(voxelSize)
      ))
  }

  private def createVolumeDataSource(voxelSize: Option[VoxelSize]): UsableDataSource = {
    val magLocators = layer.tracing.mags.map { mag =>
      MagLocator(
        mag = vec3IntToProto(mag),
        axisOrder = Some(AxisOrder.cAdditionalxyz(rank)),
        path = Some(UPath.fromStringUnsafe(s"./$defaultLayerName/${mag.toMagLiteral(allowScalar = true)}"))
      )
    }
    UsableDataSource(
      id = DataSourceId("", ""),
      dataLayers = List(
        StaticSegmentationLayer(
          defaultLayerName,
          DataFormat.zarr3,
          layer.boundingBox,
          layer.elementClass,
          magLocators.toList,
          additionalAxes =
            if (additionalAxesSorted.isEmpty) None
            else Some(additionalAxesSorted)
        )),
      scale = voxelSize.getOrElse(VoxelSize.fromFactorWithDefaultUnit(Vec3Double.ones)) // Download should still be available if the dataset no longer exists. In that case, the voxel size is unknown
    )
  }

  private def reorderAdditionalCoordinates(additionalCoordinates: Seq[AdditionalCoordinate],
                                           additionalAxesSorted: Seq[AdditionalAxis]): Seq[AdditionalCoordinate] =
    additionalCoordinates.sortBy(c => additionalAxesSorted.indexWhere(a => a.name == c.name))

  private def zarrChunkFilePath(layerName: String,
                                bucketPosition: BucketPosition,
                                additionalAxesSorted: Seq[AdditionalAxis]): String = {
    // In volume annotations, store buckets/chunks as additionalCoordinates, then z,y,x
    val additionalCoordinatesPart =
      additionalCoordinatesFilePath(bucketPosition.additionalCoordinates, additionalAxesSorted)
    val channelPart = 0
    s"$layerName/${bucketPosition.mag.toMagLiteral(allowScalar = true)}/$channelPart$dimensionSeparator$additionalCoordinatesPart${bucketPosition.bucketX}$dimensionSeparator${bucketPosition.bucketY}$dimensionSeparator${bucketPosition.bucketZ}"
  }

  private def additionalCoordinatesFilePath(additionalCoordinatesOpt: Option[Seq[AdditionalCoordinate]],
                                            additionalAxesSorted: Seq[AdditionalAxis]) =
    additionalCoordinatesOpt match {
      case Some(additionalCoordinates) if additionalCoordinates.nonEmpty =>
        reorderAdditionalCoordinates(additionalCoordinates, additionalAxesSorted)
          .map(_.value)
          .mkString(dimensionSeparator) + dimensionSeparator
      case _ => ""
    }

  private def zarrHeaderFilePath(layerName: String, mag: Vec3Int): String =
    s"$layerName/${mag.toMagLiteral(allowScalar = true)}/${Zarr3ArrayHeader.FILENAME_ZARR_JSON}"

  private lazy val compressor = BloscCodec.fromConfiguration(BloscCodecConfiguration.defaultForWKZarrOutput).compressor

}
