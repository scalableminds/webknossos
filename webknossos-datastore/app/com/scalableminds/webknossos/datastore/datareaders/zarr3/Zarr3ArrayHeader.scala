package com.scalableminds.webknossos.datastore.datareaders.zarr3

import com.scalableminds.util.tools.BoxImplicits
import com.scalableminds.webknossos.datastore.datareaders.ArrayDataType.ArrayDataType
import com.scalableminds.webknossos.datastore.datareaders.ArrayOrder.ArrayOrder
import com.scalableminds.webknossos.datastore.datareaders.DimensionSeparator.DimensionSeparator
import com.scalableminds.webknossos.datastore.datareaders.zarr3.Zarr3DataType.{Zarr3DataType, raw}
import com.scalableminds.webknossos.datastore.datareaders.{
  ArrayOrder,
  Compressor,
  DatasetHeader,
  DimensionSeparator,
  NullCompressor
}
import com.scalableminds.webknossos.datastore.helpers.JsonImplicits
import com.scalableminds.webknossos.datastore.models.datasource.ElementClass
import net.liftweb.common.Box.tryo
import net.liftweb.common.{Box, Full}
import play.api.libs.json.{Format, JsArray, JsResult, JsString, JsSuccess, JsValue, Json, OFormat}

import java.nio.ByteOrder

case class Zarr3ArrayHeader(
    zarr_format: Int, // must be 3
    node_type: String, // must be "array"
    shape: Array[Int],
    data_type: Either[String, ExtensionDataType],
    chunk_grid: Either[ChunkGridSpecification, ExtensionChunkGridSpecification],
    chunk_key_encoding: ChunkKeyEncoding,
    fill_value: Either[String, Number], // Boolean not supported
    attributes: Option[Map[String, String]],
    codecs: Seq[CodecConfiguration],
    storage_transformers: Option[Seq[StorageTransformerSpecification]],
    dimension_names: Option[Array[String]]
) extends DatasetHeader
    with BoxImplicits {

  override def datasetShape: Array[Int] = shape

  override def chunkSize: Array[Int] = getChunkSize

  override def dimension_separator: DimensionSeparator = getDimensionSeparator

  override def dataType: String = data_type.left.getOrElse("extension")

  override lazy val order: ArrayOrder = getOrder

  override lazy val byteOrder: ByteOrder = ByteOrder.LITTLE_ENDIAN

  private def zarr3DataType: Zarr3DataType = Zarr3DataType.fromString(dataType).getOrElse(raw)

  override def resolvedDataType: ArrayDataType = Zarr3DataType.toArrayDataType(zarr3DataType)

  override def compressorImpl: Compressor = new NullCompressor // Not used, since specific chunk reader is used

  override def voxelOffset: Array[Int] = Array.fill(datasetShape.length)(0)

  override def isSharded: Boolean =
    shardingCodecConfiguration.isDefined

  private def shardingCodecConfiguration = codecs.collectFirst {
    case s: ShardingCodecConfiguration => s
  }

  def assertValid: Box[Unit] =
    for {
      _ <- bool2Box(zarr_format == 3) ?~! s"Expected zarr_format 3, got $zarr_format"
      _ <- bool2Box(node_type == "array") ?~! s"Expected node_type 'array', got $node_type"
      _ <- tryo(resolvedDataType) ?~! "Data type is not supported"
      _ <- shardingCodecConfiguration
        .map(_.isSupported)
        .getOrElse(Full(())) ?~! "Sharding codec configuration is not supported"
    } yield ()

  def elementClass: Option[ElementClass.Value] = ElementClass.fromArrayDataType(resolvedDataType)

  def outerChunkSize: Array[Int] = chunk_grid match {
    case Left(chunkGridSpecification) => chunkGridSpecification.configuration.chunk_shape
    case Right(_)                     => ???
  }

  private def getChunkSize: Array[Int] = {
    val shardingCodecInnerChunkSize = codecs.flatMap {
      case ShardingCodecConfiguration(chunk_shape, _, _, _) => Some(chunk_shape)
      case _                                                => None
    }.headOption
    shardingCodecInnerChunkSize.getOrElse(outerChunkSize)
  }

  // Note: this currently works if only a single transpose codec is present,
  // and if it is either "F", "C" or an array value equivalent to "F" or "C"
  // compare https://github.com/scalableminds/webknossos/issues/7116
  private def getOrder: ArrayOrder.Value =
    CodecTreeExplorer.findOne {
      case TransposeCodecConfiguration(StringTransposeSetting(order)) => order == "F"
      case TransposeCodecConfiguration(IntArrayTransposeSetting(order)) =>
        order.sameElements(TransposeSetting.fOrderFromRank(rank).order)
      case _ => false
    }(codecs).map(_ => ArrayOrder.F).getOrElse(ArrayOrder.C)

  private def getDimensionSeparator =
    DimensionSeparator.fromString(chunk_key_encoding.getSeparator).getOrElse(DimensionSeparator.SLASH)
}

case class ChunkGridConfiguration(
    chunk_shape: Array[Int]
)

object ChunkGridConfiguration {
  implicit val jsonFormat: OFormat[ChunkGridConfiguration] =
    Json.format[ChunkGridConfiguration]
}

case class ChunkGridSpecification(
    name: String,
    configuration: ChunkGridConfiguration
)

object ChunkGridSpecification {
  implicit val jsonFormat: OFormat[ChunkGridSpecification] =
    Json.format[ChunkGridSpecification]
}

case class ChunkKeyEncodingConfiguration(
    separator: Option[String]
)

object ChunkKeyEncodingConfiguration {
  implicit val jsonFormat: OFormat[ChunkKeyEncodingConfiguration] =
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

object ChunkKeyEncoding {
  implicit val jsonFormat: OFormat[ChunkKeyEncoding] =
    Json.format[ChunkKeyEncoding]
}

case class StorageTransformerSpecification(
    name: String,
    configuration: Option[Map[String, String]] // Should be specified once storage transformers are implemented
)

object StorageTransformerSpecification {
  implicit val jsonFormat: OFormat[StorageTransformerSpecification] =
    Json.format[StorageTransformerSpecification]
}

object Zarr3ArrayHeader extends JsonImplicits {

  def FILENAME_ZARR_JSON = "zarr.json"
  implicit object Zarr3ArrayHeaderFormat extends Format[Zarr3ArrayHeader] {
    override def reads(json: JsValue): JsResult[Zarr3ArrayHeader] =
      for {
        zarr_format <- (json \ "zarr_format").validate[Int]
        node_type <- (json \ "node_type").validate[String]
        shape <- (json \ "shape").validate[Array[Int]]
        data_type <- (json \ "data_type").validate[String]
        chunk_grid <- (json \ "chunk_grid").validate[ChunkGridSpecification]
        chunk_key_encoding <- (json \ "chunk_key_encoding").validate[ChunkKeyEncoding]
        fill_value <- (json \ "fill_value").validate[Either[String, Number]]
        attributes = (json \ "attributes").validate[Map[String, String]].asOpt
        codecsJsValue <- (json \ "codecs").validate[JsValue]
        codecs = readCodecs(codecsJsValue)
        dimension_names <- (json \ "dimension_names").validate[Array[String]].orElse(JsSuccess(Array[String]()))
      } yield
        Zarr3ArrayHeader(
          zarr_format,
          node_type,
          shape,
          Left(data_type),
          Left(chunk_grid),
          chunk_key_encoding,
          fill_value,
          attributes,
          codecs,
          storage_transformers = None, // No storage transformers are currently defined
          Some(dimension_names)
        )

    private def readShardingCodecConfiguration(config: JsValue): JsResult[ShardingCodecConfiguration] =
      for {
        chunk_shape <- config("chunk_shape").validate[Array[Int]]
        codecs = readCodecs(config("codecs"))
        index_codecs = readCodecs(config("index_codecs"))
        index_location = (config \ "index_location")
          .asOpt[IndexLocationSetting.IndexLocationSetting]
          .getOrElse(IndexLocationSetting.end)
      } yield ShardingCodecConfiguration(chunk_shape, codecs, index_codecs, index_location)

    private def readCodecs(value: JsValue): Seq[CodecConfiguration] = {
      val rawCodecSpecs: Seq[JsValue] = value match {
        case JsArray(arr) => arr.toSeq
        case _            => Seq()
      }
      val configurationKey = "configuration"
      val codecSpecs = rawCodecSpecs.map(c => {
        for {
          spec: CodecConfiguration <- c("name") match {
            case JsString(BytesCodecConfiguration.name)       => c(configurationKey).validate[BytesCodecConfiguration]
            case JsString(BytesCodecConfiguration.legacyName) => c(configurationKey).validate[BytesCodecConfiguration]
            case JsString(TransposeCodecConfiguration.name)   => c(configurationKey).validate[TransposeCodecConfiguration]
            case JsString(GzipCodecConfiguration.name)        => c(configurationKey).validate[GzipCodecConfiguration]
            case JsString(BloscCodecConfiguration.name)       => c(configurationKey).validate[BloscCodecConfiguration]
            case JsString(ZstdCodecConfiguration.name)        => c(configurationKey).validate[ZstdCodecConfiguration]
            case JsString(Crc32CCodecConfiguration.name) =>
              JsSuccess(Crc32CCodecConfiguration) // Crc32 codec has no configuration
            case JsString(ShardingCodecConfiguration.name) => readShardingCodecConfiguration(c(configurationKey))
            case JsString(name)                            => throw new UnsupportedOperationException(s"Codec $name is not supported.")
            case _                                         => throw new IllegalArgumentException()
          }
        } yield spec
      })
      codecSpecs.flatMap(possibleCodecSpec =>
        possibleCodecSpec.map((s: CodecConfiguration) => Seq(s)).getOrElse(Seq[CodecConfiguration]()))
    }

    override def writes(zarrArrayHeader: Zarr3ArrayHeader): JsValue =
      Json.obj(
        "zarr_format" -> zarrArrayHeader.zarr_format,
        "node_type" -> zarrArrayHeader.node_type,
        "shape" -> zarrArrayHeader.shape,
        "data_type" -> Json
          .toJsFieldJsValueWrapper(zarrArrayHeader.data_type.left.getOrElse("extension")), // Extension not supported for now
        "chunk_grid" -> Json.toJsFieldJsValueWrapper(
          zarrArrayHeader.chunk_grid.left.getOrElse(ChunkGridSpecification(
            "regular",
            ChunkGridConfiguration(Array(1, 1, 1))))), // Extension not supported for now
        "chunk_key_encoding" -> zarrArrayHeader.chunk_key_encoding,
        "fill_value" -> zarrArrayHeader.fill_value,
        "attributes" -> Json.toJsFieldJsValueWrapper(zarrArrayHeader.attributes.getOrElse(Map("" -> ""))),
        "codecs" -> zarrArrayHeader.codecs.map { codec: CodecConfiguration =>
          val configurationJson = if (codec.includeConfiguration) Json.obj("configuration" -> codec) else Json.obj()
          Json.obj("name" -> codec.name) ++ configurationJson
        },
        "storage_transformers" -> zarrArrayHeader.storage_transformers,
        "dimension_names" -> zarrArrayHeader.dimension_names
      )
  }
}
