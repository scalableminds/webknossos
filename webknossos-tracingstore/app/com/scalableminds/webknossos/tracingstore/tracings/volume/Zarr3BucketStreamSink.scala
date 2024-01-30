package com.scalableminds.webknossos.tracingstore.tracings.volume

import com.scalableminds.util.geometry.{Vec3Double, Vec3Int}
import com.scalableminds.util.io.{NamedFunctionStream, NamedStream}
import com.scalableminds.util.tools.ByteUtils
import com.scalableminds.webknossos.datastore.dataformats.MagLocator
import com.scalableminds.webknossos.datastore.dataformats.zarr3.Zarr3SegmentationLayer
import com.scalableminds.webknossos.datastore.datareaders.zarr3._
import com.scalableminds.webknossos.datastore.datareaders.{
  AxisOrder,
  BloscCompressor,
  IntCompressionSetting,
  StringCompressionSetting
}
import com.scalableminds.webknossos.datastore.geometry.AdditionalAxisProto
import com.scalableminds.webknossos.datastore.helpers.ProtoGeometryImplicits
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayer, DataSourceId, GenericDataSource}
import com.scalableminds.webknossos.datastore.models.{AdditionalCoordinate, BucketPosition}
import play.api.libs.json.Json

import scala.concurrent.{ExecutionContext, Future}

// Creates data zip from volume tracings
class Zarr3BucketStreamSink(val layer: VolumeTracingLayer, tracingHasFallbackLayer: Boolean)
    extends ProtoGeometryImplicits
    with VolumeBucketReversionHelper
    with ByteUtils {

  private lazy val defaultLayerName = "volumeAnnotationData"
  private lazy val dimensionSeparator = "."

  def apply(bucketStream: Iterator[(BucketPosition, Array[Byte])],
            mags: Seq[Vec3Int],
            additionalAxes: Seq[AdditionalAxisProto],
            voxelSize: Option[Vec3Double])(implicit ec: ExecutionContext): Iterator[NamedStream] = {
    val rank = additionalAxes.length + 4
    val header = Zarr3ArrayHeader(
      zarr_format = 3,
      node_type = "array",
      // channel, additional axes, XYZ
      shape = Array(1) ++ additionalAxes.map(_.bounds.y).toArray ++ layer.boundingBox.bottomRight.toArray,
      data_type = Left(layer.elementClass.toString),
      chunk_grid = Left(
        ChunkGridSpecification(
          "regular",
          ChunkGridConfiguration(
            chunk_shape = Array.fill(additionalAxes.length + 1)(1) ++ Array(DataLayer.bucketLength,
                                                                            DataLayer.bucketLength,
                                                                            DataLayer.bucketLength))
        )),
      chunk_key_encoding =
        ChunkKeyEncoding("default",
                         configuration = Some(ChunkKeyEncodingConfiguration(separator = Some(dimensionSeparator)))),
      fill_value = Right(0),
      attributes = None,
      codecs = Seq(
        TransposeCodecConfiguration(TransposeSetting.fOrderFromRank(rank)),
        BytesCodecConfiguration(Some("little")),
        BloscCodecConfiguration(
          BloscCompressor.defaultCname,
          BloscCompressor.defaultCLevel,
          StringCompressionSetting(BloscCodecConfiguration.shuffleSettingFromInt(BloscCompressor.defaultShuffle)),
          Some(BloscCompressor.defaultTypesize),
          BloscCompressor.defaultBlocksize
        )
      ),
      storage_transformers = None,
      dimension_names = Some(Array("c") ++ additionalAxes.map(_.name).toArray ++ Seq("x", "y", "z"))
    )
    bucketStream.flatMap {
      case (bucket, data) =>
        val skipBucket = if (tracingHasFallbackLayer) isAllZero(data) else isRevertedBucket(data)
        if (skipBucket) {
          // If the tracing has no fallback segmentation, all-zero buckets can be omitted entirely
          None
        } else {
          val filePath = zarrChunkFilePath(defaultLayerName, bucket)
          Some(
            NamedFunctionStream(
              filePath,
              os => Future.successful(os.write(compressor.compress(data)))
            )
          )
        }
      case _ => None
    } ++ mags.map { mag =>
      NamedFunctionStream.fromString(zarrHeaderFilePath(defaultLayerName, mag), Json.prettyPrint(Json.toJson(header)))
    } ++ Seq(
      NamedFunctionStream.fromString(
        GenericDataSource.FILENAME_DATASOURCE_PROPERTIES_JSON,
        Json.prettyPrint(Json.toJson(createVolumeDataSource(layer, voxelSize)))
      ))
  }

  private def createVolumeDataSource(layer: VolumeTracingLayer,
                                     voxelSize: Option[Vec3Double]): GenericDataSource[DataLayer] = {
    val additionalAxes = layer.additionalAxes.flatMap(a => if (a.isEmpty) None else Some(a))
    val rank = additionalAxes.map(_.length).getOrElse(0) + 4
    val magLocators = layer.tracing.resolutions.map { mag =>
      MagLocator(mag = vec3IntToProto(mag),
                 axisOrder = Some(AxisOrder(c = Some(0), x = rank - 3, y = rank - 2, z = Some(rank - 1))))
    }
    GenericDataSource(
      id = DataSourceId("", ""),
      dataLayers = List(
        Zarr3SegmentationLayer(defaultLayerName,
                               layer.boundingBox,
                               layer.elementClass,
                               magLocators.toList,
                               additionalAxes = additionalAxes)),
      scale = voxelSize.getOrElse(Vec3Double.ones) // Download should still be available if the dataset no longer exists. In that case, the voxel size is unknown
    )
  }

  private def zarrChunkFilePath(layerName: String, bucketPosition: BucketPosition): String = {
    // In volume annotations, store buckets/chunks as additionalCoordinates, then z,y,x
    val additionalCoordinatesPart = additionalCoordinatesFilePath(bucketPosition.additionalCoordinates)
    val channelPart = 0
    s"$layerName/${bucketPosition.mag.toMagLiteral(allowScalar = true)}/c$dimensionSeparator$channelPart$dimensionSeparator$additionalCoordinatesPart${bucketPosition.bucketX}$dimensionSeparator${bucketPosition.bucketY}$dimensionSeparator${bucketPosition.bucketZ}"
  }

  private def additionalCoordinatesFilePath(additionalCoordinatesOpt: Option[Seq[AdditionalCoordinate]]) =
    additionalCoordinatesOpt match {
      case Some(additionalCoordinates) if additionalCoordinates.nonEmpty =>
        additionalCoordinates.map(_.value).mkString(dimensionSeparator) + dimensionSeparator
      case _ => ""
    }

  private def zarrHeaderFilePath(layerName: String, mag: Vec3Int): String =
    s"$layerName/${mag.toMagLiteral(allowScalar = true)}/${Zarr3ArrayHeader.FILENAME_ZARR_JSON}"

  private lazy val compressor =
    new BloscCompressor(
      Map(
        BloscCompressor.keyCname -> StringCompressionSetting(BloscCompressor.defaultCname),
        BloscCompressor.keyClevel -> IntCompressionSetting(BloscCompressor.defaultCLevel),
        BloscCompressor.keyShuffle -> IntCompressionSetting(BloscCompressor.defaultShuffle),
        BloscCompressor.keyBlocksize -> IntCompressionSetting(BloscCompressor.defaultBlocksize),
        BloscCompressor.keyTypesize -> IntCompressionSetting(BloscCompressor.defaultTypesize)
      ))

}
