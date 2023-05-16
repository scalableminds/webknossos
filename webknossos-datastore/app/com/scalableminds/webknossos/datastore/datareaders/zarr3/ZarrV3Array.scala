package com.scalableminds.webknossos.datastore.datareaders.zarr3

import com.scalableminds.webknossos.datastore.datareaders.codecs.{
  BloscCodec,
  BloscCodecSpecification,
  Codec,
  CodecSpecification,
  EndianCodec,
  EndianCodecSpecification,
  GzipCodec,
  GzipCodecSpecification,
  TransposeCodec,
  TransposeCodecSpecification
}
import com.scalableminds.webknossos.datastore.datareaders.{
  AxisOrder,
  ChunkReader,
  DatasetArray,
  DatasetHeader,
  DatasetPath
}
import com.scalableminds.webknossos.datastore.datavault.VaultPath
import com.typesafe.scalalogging.LazyLogging
import play.api.libs.json.{JsError, JsSuccess, Json}

import java.io.IOException
import java.nio.charset.StandardCharsets

// TODO: Copied from zarr array, maybe extract something
object ZarrV3Array extends LazyLogging {
  @throws[IOException]
  def open(path: VaultPath, axisOrderOpt: Option[AxisOrder], channelIndex: Option[Int]): ZarrV3Array = {
    val rootPath = new DatasetPath("")
    val headerPath = rootPath.resolve(ZarrArrayHeader.ZARR_JSON)
    val headerBytes = (path / headerPath.storeKey).readBytes()
    if (headerBytes.isEmpty)
      throw new IOException("'" + ZarrArrayHeader.ZARR_JSON + "' expected but is not readable or missing in store.")
    val headerString = new String(headerBytes.get, StandardCharsets.UTF_8)
    val header: ZarrArrayHeader =
      Json.parse(headerString).validate[ZarrArrayHeader] match {
        case JsSuccess(parsedHeader, _) =>
          parsedHeader
        case errors: JsError =>
          throw new Exception("Validating json as zarr v3 header failed: " + JsError.toJson(errors).toString())
      }
    if (header.bytesPerChunk > DatasetArray.chunkSizeLimitBytes) {
      throw new IllegalArgumentException(
        f"Chunk size of this Zarr Array exceeds limit of ${DatasetArray.chunkSizeLimitBytes}, got ${header.bytesPerChunk}")
    }
    new ZarrV3Array(rootPath, path, header, axisOrderOpt.getOrElse(AxisOrder.asZyxFromRank(header.rank)), channelIndex)
  }

}

class ZarrV3Array(relativePath: DatasetPath,
                  vaultPath: VaultPath,
                  header: DatasetHeader,
                  axisOrder: AxisOrder,
                  channelIndex: Option[Int])
    extends DatasetArray(relativePath, vaultPath, header, axisOrder, channelIndex)
    with LazyLogging {

  override protected def getChunkFilename(chunkIndex: Array[Int]): String =
    s"c${header.dimension_separator.toString}${super.getChunkFilename(chunkIndex)}"

  lazy val codecs: Seq[Codec] = initializeCodecs(specificHeader.codecs)

  private def specificHeader: ZarrArrayHeader = header.asInstanceOf[ZarrArrayHeader]

  private def initializeCodecs(codecSpecs: Seq[CodecSpecification]) =
    codecSpecs.map {
      case EndianCodecSpecification(endian)   => new EndianCodec(endian)
      case TransposeCodecSpecification(order) => new TransposeCodec(order)
      case BloscCodecSpecification(cname, clevel, shuffle, typesize, blocksize) =>
        new BloscCodec(cname, clevel, shuffle, typesize, blocksize)
      case GzipCodecSpecification(level) => new GzipCodec(level)
    }

  override protected val chunkReader: ChunkReader =
    ZarrV3ChunkReader.create(vaultPath, specificHeader, this)
}
