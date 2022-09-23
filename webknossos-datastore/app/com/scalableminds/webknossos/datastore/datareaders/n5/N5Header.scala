package com.scalableminds.webknossos.datastore.datareaders.n5

import com.scalableminds.webknossos.datastore.datareaders.ArrayDataType.ArrayDataType
import com.scalableminds.webknossos.datastore.datareaders.ArrayOrder.ArrayOrder
import com.scalableminds.webknossos.datastore.datareaders.DimensionSeparator.DimensionSeparator
import com.scalableminds.webknossos.datastore.datareaders._
import com.scalableminds.webknossos.datastore.helpers.JsonImplicits
import play.api.libs.json.Json.WithDefaultValues
import play.api.libs.json._

import java.nio.ByteOrder

case class N5BlockHeader(blockSize: Array[Int], numElements: Int)
object N5BlockHeader {
  implicit val jsonFormat: OFormat[N5BlockHeader] = Json.format[N5BlockHeader]
}

case class N5Header(
    dimensions: Array[Int], // shape of the entire array
    blockSize: Array[Int], // shape of each chunk
    compression: Option[Map[String, CompressionSetting]] = None, // specifies compressor to use, with parameters
    dataType: String,
    dimension_separator: DimensionSeparator = DimensionSeparator.SLASH
) extends DatasetHeader {
  val fill_value: Either[String, Number] = Right(0)
  val order: ArrayOrder = ArrayOrder.F

  lazy val datasetShape: Array[Int] = dimensions

  lazy val chunkSize: Array[Int] = blockSize

  override lazy val byteOrder: ByteOrder = ByteOrder.BIG_ENDIAN

  lazy val compressorImpl: Compressor =
    compression.map(N5CompressorFactory.create).getOrElse(N5CompressorFactory.nullCompressor)

  lazy val resolvedDataType: ArrayDataType =
    N5DataType.toArrayDataType(N5DataType.fromString(dataType).get)
}

object N5Header extends JsonImplicits {
  val FILENAME_DOT_ZARRAY = "attributes.json"

  implicit object N5HeaderFormat extends Format[N5Header] {
    override def reads(json: JsValue): JsResult[N5Header] =
      Json.using[WithDefaultValues].reads[N5Header].reads(json)

    override def writes(n5Header: N5Header): JsValue =
      Json.writes[N5Header].writes(n5Header)
  }
}
