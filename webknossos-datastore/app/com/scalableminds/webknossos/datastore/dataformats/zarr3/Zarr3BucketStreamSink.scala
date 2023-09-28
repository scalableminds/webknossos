package com.scalableminds.webknossos.datastore.dataformats.zarr3

import com.scalableminds.util.geometry.{Vec3Double, Vec3Int}
import com.scalableminds.util.io.{NamedFunctionStream, NamedStream}
import com.scalableminds.webknossos.datastore.datareaders.zarr3._
import com.scalableminds.webknossos.datastore.datareaders.{
  BloscCompressor,
  IntCompressionSetting,
  StringCompressionSetting
}
import com.scalableminds.webknossos.datastore.geometry.AdditionalAxisProto
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayer, DataSourceId, GenericDataSource}
import com.scalableminds.webknossos.datastore.models.{AdditionalCoordinate, BucketPosition}
import com.typesafe.scalalogging.LazyLogging
import play.api.libs.json.Json

import scala.concurrent.Future

// Creates data zip from volume tracings
class Zarr3BucketStreamSink(val layer: DataLayer) extends LazyLogging {

  private lazy val defaultLayerName = "volumeAnnotationData"
  private lazy val dimensionSeparator = "."

  def apply(bucketStream: Iterator[(BucketPosition, Array[Byte])],
            mags: Seq[Vec3Int],
            additionalAxes: Seq[AdditionalAxisProto]): Iterator[NamedStream] = {
    val header = Zarr3ArrayHeader(
      zarr_format = 3,
      node_type = "array",
      shape = additionalAxes.map(_.bounds.y).toArray ++ layer.boundingBox.bottomRight.toArray,
      data_type = Left(layer.elementClass.toString),
      chunk_grid = Left(
        ChunkGridSpecification(
          "regular",
          ChunkGridConfiguration(
            chunk_shape = Array.fill(additionalAxes.length)(1) ++ Array(DataLayer.bucketLength,
                                                                        DataLayer.bucketLength,
                                                                        DataLayer.bucketLength))
        )),
      chunk_key_encoding =
        ChunkKeyEncoding("default",
                         configuration = Some(ChunkKeyEncodingConfiguration(separator = Some(dimensionSeparator)))),
      fill_value = Right(0),
      attributes = None,
      codecs = Seq(
        TransposeCodecConfiguration("F"),
        BytesCodecConfiguration(Some("little")),
        BloscCodecConfiguration(
          BloscCompressor.defaultCname,
          BloscCompressor.defaultCLevel,
          IntCompressionSetting(BloscCompressor.defaultShuffle),
          Some(BloscCompressor.defaultTypesize),
          BloscCompressor.defaultBlocksize
        )
      ),
      storage_transformers = None,
      dimension_names = Some(additionalAxes.map(_.name).toArray ++ Seq("x", "y", "z"))
    )
    bucketStream.map {
      case (bucket, data) =>
        val filePath = zarrChunkFilePath(defaultLayerName, bucket)
        NamedFunctionStream(
          filePath,
          os => Future.successful(os.write(compressor.compress(data)))
        )
    } ++ mags.map { mag =>
      NamedFunctionStream.fromString(zarrHeaderFilePath(defaultLayerName, mag), Json.prettyPrint(Json.toJson(header)))
    } ++ Seq(
      NamedFunctionStream.fromString(
        GenericDataSource.FILENAME_DATASOURCE_PROPERTIES_JSON,
        Json.prettyPrint(Json.toJson(createVolumeDataSource(layer)))
      ))
  }

  private def createVolumeDataSource(layer: DataLayer): GenericDataSource[DataLayer] =
    GenericDataSource(
      id = DataSourceId("", ""),
      dataLayers = List(Zarr3SegmentationLayer(defaultLayerName, layer.boundingBox, layer.elementClass, List.empty, additionalAxes = layer.additionalAxes)),
      scale = Vec3Double(1.0, 1.0, 1.0), // TODO
    )

  private def zarrChunkFilePath(layerName: String, bucketPosition: BucketPosition): String = {
    // In volume annotations, store buckets/chunks as additionalCoordinates, then z,y,x
    val additionalCoordinatesPart = additionalCoordinatesFilePath(bucketPosition.additionalCoordinates)
    s"$layerName/${bucketPosition.mag
      .toMagLiteral()}/c/$additionalCoordinatesPart${bucketPosition.bucketX}$dimensionSeparator${bucketPosition.bucketY}$dimensionSeparator${bucketPosition.bucketZ}"
  }

  private def additionalCoordinatesFilePath(additionalCoordinatesOpt: Option[Seq[AdditionalCoordinate]]) =
    additionalCoordinatesOpt match {
      case Some(additionalCoordinates) if additionalCoordinates.nonEmpty =>
        additionalCoordinates.map(_.value).mkString(dimensionSeparator) + dimensionSeparator
      case _ => ""
    }

  private def zarrHeaderFilePath(layerName: String, mag: Vec3Int): String =
    s"$layerName/${mag.toMagLiteral()}/${Zarr3ArrayHeader.FILENAME_ZARR_JSON}"

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
