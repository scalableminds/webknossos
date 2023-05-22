package com.scalableminds.webknossos.datastore.datareaders.zarr3

import com.scalableminds.webknossos.datastore.datareaders.ArrayDataType.ArrayDataType
import com.scalableminds.webknossos.datastore.datareaders.ArrayOrder.ArrayOrder
import com.scalableminds.webknossos.datastore.datareaders.DimensionSeparator.DimensionSeparator
import com.scalableminds.webknossos.datastore.datareaders.zarr3.ZarrV3DataType.{ZarrV3DataType, raw}
import com.scalableminds.webknossos.datastore.datareaders.{
  ArrayOrder,
  Compressor,
  DatasetHeader,
  DimensionSeparator,
  NullCompressor
}
import com.scalableminds.webknossos.datastore.helpers.JsonImplicits
import com.scalableminds.webknossos.datastore.models.datasource.ElementClass
import play.api.libs.json.{Format, JsArray, JsResult, JsString, JsSuccess, JsValue, Json, OFormat}

case class ZarrArrayHeader(
    zarr_format: Int, // must be 3
    node_type: String, // must be "array"
    shape: Array[Int],
    data_type: Either[String, ExtensionDataType],
    chunk_grid: Either[ChunkGridSpecification, ExtensionChunkGridSpecification],
    chunk_key_encoding: ChunkKeyEncoding,
    fill_value: Either[String, Number], // Boolean not supported
    attributes: Option[Map[String, String]],
    codecs: Seq[CodecSpecification],
    storage_transformers: Option[Seq[StorageTransformerSpecification]],
    dimension_names: Option[Array[String]]
) extends DatasetHeader {

  override def datasetShape: Array[Int] = shape
  override def chunkSize: Array[Int] = getChunkSize

  override def dimension_separator: DimensionSeparator = getDimensionSeparator

  override def dataType: String = data_type.left.getOrElse("extension")

  override lazy val order: ArrayOrder = getOrder

  def zarrV3DataType: ZarrV3DataType = ZarrV3DataType.fromString(dataType).getOrElse(raw)

  override def resolvedDataType: ArrayDataType = ZarrV3DataType.toArrayDataType(zarrV3DataType)

  override def compressorImpl: Compressor = new NullCompressor // Not used, since specific chunk reader is used

  override def voxelOffset: Array[Int] = Array.fill(datasetShape.length)(0)

  override def isSharded: Boolean =
    codecs.exists {
      case _: ShardingCodecSpecification => true
      case _                             => false
    }

  def isValid: Boolean = zarr_format == 3 && node_type == "array"

  def elementClass: Option[ElementClass.Value] = ElementClass.fromArrayDataType(resolvedDataType)

  private def getChunkSize: Array[Int] =
    chunk_grid match {
      case Left(cgs) => cgs.configuration.chunk_shape
      case Right(_)  => ???
    }

  // TODO: rework this, doesn't work for arbitrary transforms, does not work for sharding.
  private def getOrder: ArrayOrder.Value = {
    val transposeCodecs: Option[CodecSpecification] = codecs.find(c => c.isInstanceOf[TransposeCodecSpecification])
    transposeCodecs
      .map(c => if (c.asInstanceOf[TransposeCodecSpecification].order == "F") { ArrayOrder.F } else { ArrayOrder.C })
      .getOrElse(ArrayOrder.C)
  }

  private def getDimensionSeparator =
    DimensionSeparator.fromString(chunk_key_encoding.getSeparator).getOrElse(DimensionSeparator.SLASH)
}

case class ChunkGridConfiguration(
    chunk_shape: Array[Int]
)

object ChunkGridConfiguration extends JsonImplicits {
  implicit val chunkGridConfigurationFormat: OFormat[ChunkGridConfiguration] =
    Json.format[ChunkGridConfiguration]
}

case class ChunkGridSpecification(
    name: String,
    configuration: ChunkGridConfiguration
)

object ChunkGridSpecification extends JsonImplicits {
  implicit val chunkGridSpecificationFormat: OFormat[ChunkGridSpecification] =
    Json.format[ChunkGridSpecification]
}

case class ChunkKeyEncodingConfiguration(
    separator: Option[String]
)

object ChunkKeyEncodingConfiguration extends JsonImplicits {
  implicit val chunkKeyEncodingConfigurationFormat: OFormat[ChunkKeyEncodingConfiguration] =
    Json.format[ChunkKeyEncodingConfiguration]
}

case class ChunkKeyEncoding(
    name: String,
    configuration: Option[ChunkKeyEncodingConfiguration]
) {
  private def isDefaultEncoding = name == "default"
  private def isV2Encoding = name == "v2"

  def getSeparator: String =
    if (isDefaultEncoding) {
      configuration.map(_.separator.getOrElse("/")).getOrElse("/")
    } else if (isV2Encoding) {
      configuration.map(_.separator.getOrElse(".")).getOrElse(".")
    } else {
      "/"
    }
}

object ChunkKeyEncoding extends JsonImplicits {
  implicit val chunkKeyEncodingFormat: OFormat[ChunkKeyEncoding] =
    Json.format[ChunkKeyEncoding]
}

case class StorageTransformerSpecification(
    name: String,
    configuration: Option[Map[String, String]] // Should be specified once storage transformers are implemented
)

object StorageTransformerSpecification extends JsonImplicits {
  implicit val storageTransformerSpecificationFormat: OFormat[StorageTransformerSpecification] =
    Json.format[StorageTransformerSpecification]
}

object ZarrArrayHeader extends JsonImplicits {

  def ZARR_JSON = "zarr.json"
  implicit object ZarrArrayHeaderFormat extends Format[ZarrArrayHeader] {
    override def reads(json: JsValue): JsResult[ZarrArrayHeader] =
      for {
        zarr_format <- json("zarr_format").validate[Int]
        node_type <- json("node_type").validate[String]
        shape <- json("shape").validate[Array[Int]]
        data_type <- json("data_type").validate[String]
        chunk_grid <- json("chunk_grid").validate[ChunkGridSpecification]
        chunk_key_encoding <- json("chunk_key_encoding").validate[ChunkKeyEncoding]
        fill_value <- json("fill_value").validate[Either[String, Number]]
        codecs = readCodecs(json("codecs"))
        dimension_names <- json("dimension_names").validate[Array[String]].orElse(JsSuccess(Array[String]()))
      } yield
        ZarrArrayHeader(
          zarr_format,
          node_type,
          shape,
          Left(data_type),
          Left(chunk_grid),
          chunk_key_encoding,
          fill_value,
          attributes = None,
          codecs,
          storage_transformers = None,
          Some(dimension_names)
        )

    private def readCodecs(value: JsValue): Seq[CodecSpecification] = {
      val rawCodecSpecs: Seq[JsValue] = value match {
        case JsArray(arr) => arr
        case _            => Seq()
      }
      val codecSpecs = rawCodecSpecs.map(c => {
        for {
          spec: CodecSpecification <- c("name") match { // TODO No row strings
            case JsString("endian")           => c("configuration").validate[EndianCodecSpecification]
            case JsString("transpose")        => c("configuration").validate[TransposeCodecSpecification]
            case JsString("gzip")             => c("configuration").validate[GzipCodecSpecification]
            case JsString("blosc")            => c("configuration").validate[BloscCodecSpecification]
            case JsString("sharding_indexed") => c("configuration").validate[ShardingCodecSpecification]
            case JsString(name)               => throw new UnsupportedOperationException(s"Codec $name is not supported.")
            case _                            => throw new IllegalArgumentException()
          }
        } yield spec
      })
      codecSpecs.flatMap(possibleCodecSpec =>
        possibleCodecSpec.map((s: CodecSpecification) => Seq(s)).getOrElse(Seq[CodecSpecification]()))
    }

    override def writes(zarrArrayHeader: ZarrArrayHeader): JsValue =
      Json.obj(
        "zarr_format" -> zarrArrayHeader.zarr_format,
        "node_type" -> zarrArrayHeader.node_type,
        "shape" -> zarrArrayHeader.shape,
        "data_type" -> Json
          .toJsFieldJsValueWrapper((zarrArrayHeader.data_type.left.getOrElse("extension"))), // Extension not supported for now
        //"chunk_grid" -> zarrArrayHeader.chunk_grid.left
        //  .getOrElse(ChunkGridSpecification("regular", ChunkGridConfiguration(Array(1, 1, 1)))), //TODO
        "chunk_key_encoding" -> zarrArrayHeader.chunk_key_encoding,
        "fill_value" -> zarrArrayHeader.fill_value,
        "attributes" -> Json.toJsFieldJsValueWrapper(zarrArrayHeader.attributes.getOrElse(Map("" -> ""))),
        "codecs" -> zarrArrayHeader.codecs,
        "storage_transformers" -> zarrArrayHeader.storage_transformers,
        "dimension_names" -> zarrArrayHeader.dimension_names
      )
  }
}
