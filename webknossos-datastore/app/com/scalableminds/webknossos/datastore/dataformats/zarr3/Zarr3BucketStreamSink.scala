package com.scalableminds.webknossos.datastore.dataformats.zarr3

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.io.{NamedFunctionStream, NamedStream}
import com.scalableminds.webknossos.datastore.datareaders.{
  BloscCompressor,
  IntCompressionSetting,
  StringCompressionSetting
}
import com.scalableminds.webknossos.datastore.datareaders.zarr3.{
  ChunkGridConfiguration,
  ChunkGridSpecification,
  ChunkKeyEncoding,
  ChunkKeyEncodingConfiguration,
  Zarr3ArrayHeader
}
import com.scalableminds.webknossos.datastore.geometry.AdditionalAxisProto
import com.scalableminds.webknossos.datastore.models.{AdditionalCoordinate, BucketPosition}
import com.scalableminds.webknossos.datastore.models.datasource.DataLayer
import play.api.libs.json.Json

import java.nio.charset.Charset
import scala.concurrent.Future

class Zarr3BucketStreamSink(val layer: DataLayer) {

  // In volume annotations, store buckets/chunks as additionalCoordinates, then z,y,x

  private val dimensionSeparator = "/"

  private def zarrChunkFilePath(bucketPosition: BucketPosition): String = {
    val additionalCoordinatesPart = additionalCoordinatesFilePath(bucketPosition.additionalCoordinates)
    s"${bucketPosition.mag.toMagLiteral()}/c/$additionalCoordinatesPart${bucketPosition.bucketZ}/${bucketPosition.bucketY}/${bucketPosition.bucketX}"
  }

  private def additionalCoordinatesFilePath(additionalCoordinatesOpt: Option[Seq[AdditionalCoordinate]]) =
    additionalCoordinatesOpt match {
      case Some(additionalCoordinates) if additionalCoordinates.nonEmpty =>
        additionalCoordinates.map(_.value).mkString("/") + dimensionSeparator
      case _ => ""
    }

  private def zarrHeaderFilePath(mag: Vec3Int): String = s"${mag.toMagLiteral()}/zarr.json"

  private lazy val compressor =
    new BloscCompressor(
      Map(
        BloscCompressor.keyCname -> StringCompressionSetting(BloscCompressor.defaultCname),
        BloscCompressor.keyClevel -> IntCompressionSetting(BloscCompressor.defaultCLevel),
        BloscCompressor.keyShuffle -> IntCompressionSetting(BloscCompressor.defaultShuffle),
        BloscCompressor.keyBlocksize -> IntCompressionSetting(BloscCompressor.defaultBlocksize),
        BloscCompressor.keyTypesize -> IntCompressionSetting(BloscCompressor.defaultTypesize)
      ))

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
      codecs = Seq(),
      storage_transformers = None,
      dimension_names = Some((additionalAxes.map(_.name) ++ Seq("z", "y", "x")).toArray)
    )
    bucketStream.map {
      case (bucket, data) =>
        val filePath = zarrChunkFilePath(bucket)
        NamedFunctionStream(
          filePath,
          os => Future.successful(os.write(compressor.compress(data)))
        )
    } ++ mags.map { mag =>
      NamedFunctionStream(
        zarrHeaderFilePath(mag),
        os => Future.successful(os.write(Json.prettyPrint(Json.toJson(header)).getBytes(Charset.forName("UTF-8")))))
    }
  }

}
