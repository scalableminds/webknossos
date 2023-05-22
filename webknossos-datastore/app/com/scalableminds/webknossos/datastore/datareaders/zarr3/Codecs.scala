package com.scalableminds.webknossos.datastore.datareaders.zarr3

import com.scalableminds.webknossos.datastore.datareaders.{
  BloscCompressor,
  BoolCompressionSetting,
  CompressionSetting,
  GzipCompressor,
  IntCompressionSetting,
  MultiArrayUtils,
  StringCompressionSetting
}
import com.scalableminds.webknossos.datastore.helpers.JsonImplicits
import play.api.libs.json.{Format, JsResult, JsValue, Json, OFormat}
import play.api.libs.json.Json.WithDefaultValues
import ucar.ma2.{Array => MultiArray}
trait Codec {
  def name: String
}

trait ArrayToArrayCodec extends Codec {
  def encode(array: MultiArray): MultiArray
  def decode(array: MultiArray): MultiArray
}

trait ArrayToBytesCodec extends Codec {
  def encode(array: MultiArray): Array[Byte]
  def decode(bytes: Array[Byte]): MultiArray
}

trait BytesToBytesCodec extends Codec {
  def encode(bytes: Array[Byte]): Array[Byte]
  def decode(bytes: Array[Byte]): Array[Byte]
}

class EndianCodec(val endian: String) extends ArrayToBytesCodec {

  /*
  https://zarr-specs.readthedocs.io/en/latest/v3/codecs/endian/v1.0.html
  Each element of the array is encoded using the specified endian
  variant of its default binary representation. Array elements are
  encoded in lexicographical order. For example, with endian
  specified as big, the int32 data type is encoded as a 4-byte big
  endian two’s complement integer, and the complex128 data type is
  encoded as two consecutive 8-byte big endian IEEE 754 binary64 values.

  Note that lexicographical order = Row-major order = C-order
   */
  override def encode(array: MultiArray): Array[Byte] = ???

  override def decode(bytes: Array[Byte]): MultiArray = ???

  override def name: String = "endian"
}

class TransposeCodec(order: String) extends ArrayToArrayCodec {
  override def encode(array: MultiArray): MultiArray =
    order match {
      case "C" => array
      case "F" => MultiArrayUtils.orderFlippedView(array)
      case _   => ???
    }

  override def decode(array: MultiArray): MultiArray =
    encode(array)

  override def name: String = "transpose"
}

class BloscCodec(cname: String, clevel: Int, shuffle: CompressionSetting, typesize: Option[Int], blocksize: Int)
    extends BytesToBytesCodec {

  private def getCompressorSettings = Map(
    BloscCompressor.keyCname -> StringCompressionSetting(cname),
    BloscCompressor.keyClevel -> IntCompressionSetting(clevel),
    BloscCompressor.keyShuffle -> IntCompressionSetting(shuffleToInt),
    BloscCompressor.keyBlocksize -> IntCompressionSetting(blocksize),
    BloscCompressor.keyTypesize -> IntCompressionSetting(typesize.getOrElse(0))
  )

  private def shuffleToInt = shuffle match {
    case StringCompressionSetting(s) =>
      s match {
        case "noshuffle"  => 0
        case "shuffle"    => 1
        case "bitshuffle" => 2
      }
    case IntCompressionSetting(x)  => x
    case BoolCompressionSetting(_) => ???
  }

  lazy val compressor = new BloscCompressor(getCompressorSettings)
  override def encode(bytes: Array[Byte]): Array[Byte] = compressor.compress(bytes)

  override def decode(bytes: Array[Byte]): Array[Byte] = compressor.decompress(bytes)

  override def name: String = "blosc"
}

class GzipCodec(level: Int) extends BytesToBytesCodec {

  lazy val compressor = new GzipCompressor(Map("level" -> IntCompressionSetting(level)))

  override def encode(bytes: Array[Byte]): Array[Byte] = compressor.compress(bytes)

  override def decode(bytes: Array[Byte]): Array[Byte] = compressor.decompress(bytes)

  override def name: String = "gzip" // TODO: Move names to object?
}

class ShardingCodec(val chunk_shape: Array[Int], val codecs: Seq[CodecSpecification]) extends ArrayToBytesCodec {

  override def encode(array: MultiArray): Array[Byte] = ???

  override def decode(bytes: Array[Byte]): MultiArray = ???

  override def name: String = "sharding_indexed"
}

sealed trait CodecSpecification

final case class EndianCodecSpecification(endian: String) extends CodecSpecification

object EndianCodecSpecification {
  implicit val EndianCodecSpecificationFormat: OFormat[EndianCodecSpecification] = Json.format[EndianCodecSpecification]
}
final case class TransposeCodecSpecification(order: String) extends CodecSpecification // Should also support other parameters

object TransposeCodecSpecification {
  implicit val TransposeCodecSpecificationFormat: OFormat[TransposeCodecSpecification] =
    Json.format[TransposeCodecSpecification]
}
final case class BloscCodecSpecification(cname: String,
                                         clevel: Int,
                                         shuffle: CompressionSetting,
                                         typesize: Option[Int],
                                         blocksize: Int)
    extends CodecSpecification

object BloscCodecSpecification {
  implicit val BloscCodecSpecificationFormat: OFormat[BloscCodecSpecification] = Json.format[BloscCodecSpecification]
}

final case class GzipCodecSpecification(level: Int) extends CodecSpecification
object GzipCodecSpecification {
  implicit val GzipCodecSpecificationFormat: OFormat[GzipCodecSpecification] = Json.format[GzipCodecSpecification]
}

object CodecSpecification extends JsonImplicits {
  implicit object CodecSpecificationFormat extends Format[CodecSpecification] {
    override def reads(json: JsValue): JsResult[CodecSpecification] =
      Json.using[WithDefaultValues].reads[CodecSpecification].reads(json)

    override def writes(obj: CodecSpecification): JsValue =
      Json.writes[CodecSpecification].writes(obj)
  }
}

final case class ShardingCodecSpecification(chunk_shape: Array[Int], codecs: Seq[CodecSpecification])
    extends CodecSpecification

object ShardingCodecSpecification {
  implicit val ShardingCodecSpecificationFormat: OFormat[ShardingCodecSpecification] =
    Json.format[ShardingCodecSpecification]
}
