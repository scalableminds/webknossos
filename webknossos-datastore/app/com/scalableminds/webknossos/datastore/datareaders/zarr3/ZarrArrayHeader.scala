package com.scalableminds.webknossos.datastore.datareaders.zarr3

import com.scalableminds.webknossos.datastore.datareaders.ArrayDataType.ArrayDataType
import com.scalableminds.webknossos.datastore.datareaders.ArrayOrder.ArrayOrder
import com.scalableminds.webknossos.datastore.datareaders.DimensionSeparator.DimensionSeparator
import com.scalableminds.webknossos.datastore.datareaders.{Compressor, DatasetHeader, DimensionSeparator}

case class ZarrArrayHeader(
    zarr_format: Int, // must be 3
    node_type: String, // must be "array"
    shape: Array[Int],
    data_type: Either[String, ExtensionDataType],
    chunk_grid: Either[ChunkGridSpecification, ExtensionChunkGridSpecification],
    chunk_key_encoding: ChunkKeyEncoding,
    fill_value: Either[String, Number], // Boolean not supported
    attributes: Option[Map[String, Any]],
    codecs: Option[Seq[CodecSpecification]],
    storage_transformers: Option[Seq[StorageTransformerSpecification]],
    dimension_names: Option[Array[String]]
) extends DatasetHeader {

  override def datasetShape: Array[Int] = shape
  override def chunkSize: Array[Int] = getChunkSize

  override def dimension_separator: DimensionSeparator = getDimensionSeparator

  override def dataType: String = ???

  override def order: ArrayOrder = ???

  override def resolvedDataType: ArrayDataType = ???

  override def compressorImpl: Compressor = ???

  override def voxelOffset: Array[Int] = ???

  def isValid: Boolean = zarr_format == 3 && node_type == "array"

  private def getChunkSize =
    chunk_grid match {
      case Left(cgs)   => cgs.configuration.chunk_shape
      case Right(ecgs) => ???

    }

  private def getDimensionSeparator =
    DimensionSeparator
      .fromString(chunk_key_encoding.configuration match {
        case Some(config) =>
          config match {
            case Left(dckec)   => dckec.separator.getOrElse("/")
            case Right(v2ckec) => v2ckec.separator.getOrElse(".")
          }
        case None => ???
      })
      .getOrElse(DimensionSeparator.SLASH)
}

case class ChunkGridSpecification(
    name: String,
    configuration: ChunkGridConfiguration
)

case class ChunkGridConfiguration(
    chunk_shape: Array[Int]
)

case class ChunkKeyEncoding(
    name: String,
    configuration: Option[Either[DefaultChunkKeyEncodingConfiguration, V2ChunkKeyEncodingConfiguration]]
)

case class V2ChunkKeyEncodingConfiguration(
    separator: Option[String]
)

case class DefaultChunkKeyEncodingConfiguration(
    separator: Option[String]
)

case class CodecSpecification(
    name: String,
    configuration: Any
)

case class StorageTransformerSpecification(
    name: String,
    configuration: Any
)
