package com.scalableminds.webknossos.datastore.datareaders.zarr3

import com.scalableminds.util.enumeration.ExtendedEnumeration
import com.scalableminds.util.tools.{BoxImplicits, ByteUtils}
import com.scalableminds.webknossos.datastore.datareaders.{
  BloscCompressor,
  BoolCompressionSetting,
  CompressionSetting,
  GzipCompressor,
  IntCompressionSetting,
  StringCompressionSetting,
  ZstdCompressor
}
import com.scalableminds.webknossos.datastore.helpers.JsonImplicits
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Box
import play.api.libs.json.{Format, JsObject, JsResult, JsString, JsSuccess, JsValue, Json, OFormat, Reads, Writes}
import play.api.libs.json.Json.WithDefaultValues
import ucar.ma2.{Array => MultiArray}

import java.util.zip.CRC32C

sealed trait TransposeSetting
final case class StringTransposeSetting(order: String) extends TransposeSetting
final case class IntArrayTransposeSetting(order: Array[Int]) extends TransposeSetting

object TransposeSetting {
  implicit object TransposeSettingFormat extends Format[TransposeSetting] {

    override def reads(json: JsValue): JsResult[TransposeSetting] =
      json.validate[String].map(StringTransposeSetting.apply).orElse(json.validate[Array[Int]].map(IntArrayTransposeSetting.apply))

    override def writes(transposeSetting: TransposeSetting): JsValue =
      transposeSetting match {
        case StringTransposeSetting(x)   => Json.toJson(x)
        case IntArrayTransposeSetting(x) => Json.toJson(x)
      }
  }

  def fOrderFromRank(rank: Int): IntArrayTransposeSetting = IntArrayTransposeSetting(Array.range(rank - 1, -1, -1))
}

object IndexLocationSetting extends ExtendedEnumeration {
  type IndexLocationSetting = Value
  val start, end = Value

  implicit object IndexLocationSettingFormat extends Format[IndexLocationSetting] {
    override def reads(json: JsValue): JsResult[IndexLocationSetting] =
      json.validate[String].map(IndexLocationSetting.withName)
    override def writes(o: IndexLocationSetting): JsValue = JsString(o.toString)
  }
}

trait Codec

/*
Only BytesToBytesCodecs are applied using their interface, the other types are currently only used for storing
information and their decoding is implemented at other places.
 */
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

class BytesCodec(val endian: Option[String]) extends ArrayToBytesCodec {

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
}

class TransposeCodec(order: TransposeSetting) extends ArrayToArrayCodec {

  // https://zarr-specs.readthedocs.io/en/latest/v3/codecs/transpose/v1.0.html
  // encode, decode currently not implemented because the flipping is done by the header

  override def encode(array: MultiArray): MultiArray = ???

  override def decode(array: MultiArray): MultiArray = ???
}

class BloscCodec(cname: String, clevel: Int, shuffle: CompressionSetting, typesize: Option[Int], blocksize: Int)
    extends BytesToBytesCodec {

  // https://zarr-specs.readthedocs.io/en/latest/v3/codecs/blosc/v1.0.html

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
}

class GzipCodec(level: Int) extends BytesToBytesCodec {

  // https://zarr-specs.readthedocs.io/en/latest/v3/codecs/gzip/v1.0.html

  lazy val compressor = new GzipCompressor(Map("level" -> IntCompressionSetting(level)))

  override def encode(bytes: Array[Byte]): Array[Byte] = compressor.compress(bytes)

  override def decode(bytes: Array[Byte]): Array[Byte] = compressor.decompress(bytes)
}

class ZstdCodec(level: Int, checksum: Boolean) extends BytesToBytesCodec {

  // https://github.com/zarr-developers/zarr-specs/pull/256

  lazy val compressor = new ZstdCompressor(level, checksum)

  override def encode(bytes: Array[Byte]): Array[Byte] = compressor.compress(bytes)

  override def decode(bytes: Array[Byte]): Array[Byte] = compressor.decompress(bytes)

}

class Crc32CCodec extends BytesToBytesCodec with ByteUtils with LazyLogging {

  // https://zarr-specs.readthedocs.io/en/latest/v3/codecs/crc32c/v1.0.html

  private def crc32ByteLength = 4

  private class CRC32CChecksumInvalidException extends Exception

  override def encode(bytes: Array[Byte]): Array[Byte] = {
    val crc = new CRC32C()
    crc.update(bytes)
    bytes ++ longToBytes(crc.getValue).take(crc32ByteLength)
  }

  override def decode(bytes: Array[Byte]): Array[Byte] = {
    val crcPart = bytes.takeRight(crc32ByteLength)
    val dataPart = bytes.dropRight(crc32ByteLength)
    val crc = new CRC32C()
    crc.update(dataPart)
    val valid = longToBytes(crc.getValue).take(crc32ByteLength).sameElements(crcPart)
    if (!valid) {
      throw new CRC32CChecksumInvalidException
    }
    dataPart
  }
}

class ShardingCodec(val chunk_shape: Array[Int],
                    val codecs: Seq[CodecConfiguration],
                    val index_codecs: Seq[CodecConfiguration],
                    val index_location: IndexLocationSetting.IndexLocationSetting = IndexLocationSetting.end)
    extends ArrayToBytesCodec {

  // https://zarr-specs.readthedocs.io/en/latest/v3/codecs/sharding-indexed/v1.0.html
  // encode, decode not implemented as sharding is done in Zarr3Array
  override def encode(array: MultiArray): Array[Byte] = ???

  override def decode(bytes: Array[Byte]): MultiArray = ???
}

sealed trait CodecConfiguration {
  def name: String
  def includeConfiguration: Boolean = true
}

final case class BytesCodecConfiguration(endian: Option[String]) extends CodecConfiguration {
  override def name: String = BytesCodecConfiguration.name
}

object BytesCodecConfiguration {
  implicit val jsonReads: Reads[BytesCodecConfiguration] = Json.reads[BytesCodecConfiguration]

  implicit object BytesCodecConfigurationWrites extends Writes[BytesCodecConfiguration] {
    override def writes(o: BytesCodecConfiguration): JsValue =
      o.endian.map(e => Json.obj("endian" -> e)).getOrElse(Json.obj())
  }

  val legacyName = "endian"
  val name = "bytes"
}

final case class TransposeCodecConfiguration(order: TransposeSetting) extends CodecConfiguration {
  override def name: String = TransposeCodecConfiguration.name
}

object TransposeCodecConfiguration {
  implicit val jsonFormat: OFormat[TransposeCodecConfiguration] =
    Json.format[TransposeCodecConfiguration]
  val name = "transpose"
}
final case class BloscCodecConfiguration(cname: String,
                                         clevel: Int,
                                         shuffle: CompressionSetting,
                                         typesize: Option[Int],
                                         blocksize: Int)
    extends CodecConfiguration {
  override def name: String = BloscCodecConfiguration.name
}

object BloscCodecConfiguration {
  implicit val jsonFormat: OFormat[BloscCodecConfiguration] = Json.format[BloscCodecConfiguration]
  val name = "blosc"

  def shuffleSettingFromInt(shuffle: Int): String = shuffle match {
    case 0 => "noshuffle"
    case 1 => "shuffle"
    case 2 => "bitshuffle"
    case _ => ???
  }
}

final case class GzipCodecConfiguration(level: Int) extends CodecConfiguration {
  override def name: String = GzipCodecConfiguration.name
}
object GzipCodecConfiguration {
  implicit val jsonFormat: OFormat[GzipCodecConfiguration] = Json.format[GzipCodecConfiguration]
  val name = "gzip"
}

final case class ZstdCodecConfiguration(level: Int, checksum: Boolean) extends CodecConfiguration {
  override def name: String = ZstdCodecConfiguration.name
}
object ZstdCodecConfiguration {
  implicit val jsonFormat: OFormat[ZstdCodecConfiguration] = Json.format[ZstdCodecConfiguration]
  val name = "zstd"
}

case object Crc32CCodecConfiguration extends CodecConfiguration {
  override val includeConfiguration: Boolean = false
  val name = "crc32c"

  val checkSumByteLength = 4 // 32 Bit Codec => 4 Byte

  implicit object Crc32CCodecConfigurationReads extends Reads[Crc32CCodecConfiguration.type] {
    override def reads(json: JsValue): JsResult[Crc32CCodecConfiguration.type] = JsSuccess(Crc32CCodecConfiguration)
  }

  implicit object Crc32CCodecConfigurationWrites extends Writes[Crc32CCodecConfiguration.type] {
    override def writes(o: Crc32CCodecConfiguration.type): JsValue = JsObject(Seq())
  }
}

object CodecConfiguration extends JsonImplicits {
  implicit object CodecSpecificationFormat extends Format[CodecConfiguration] {
    override def reads(json: JsValue): JsResult[CodecConfiguration] =
      Json.using[WithDefaultValues].reads[CodecConfiguration].reads(json)

    override def writes(obj: CodecConfiguration): JsValue =
      Json.writes[CodecConfiguration].writes(obj)
  }
}

case class CodecSpecification(name: String, configuration: CodecConfiguration)
object CodecSpecification {
  implicit val jsonFormat: OFormat[CodecSpecification] = Json.format[CodecSpecification]
}

final case class ShardingCodecConfiguration(chunk_shape: Array[Int],
                                            codecs: Seq[CodecConfiguration],
                                            index_codecs: Seq[CodecConfiguration],
                                            index_location: IndexLocationSetting.IndexLocationSetting =
                                              IndexLocationSetting.end)
    extends CodecConfiguration
    with BoxImplicits {
  override def name: String = ShardingCodecConfiguration.name
  def isSupported: Box[Unit] =
    for {
      _ <- bool2Box(index_codecs.size <= 2) ?~! s"Maximum of 2 index codecs supported, got ${index_codecs.size}"
      _ <- bool2Box(index_codecs.count(_.name == "bytes") == 1) ?~! s"Exactly one bytes codec supported, got ${index_codecs
        .count(_.name == "bytes")}"
      _ <- bool2Box(index_codecs.count(_.name == "crc32c") <= 1) ?~! s"Maximum of 1 crc32c codec supported, got ${index_codecs
        .count(_.name == "crc32c")}"
    } yield ()

}

object ShardingCodecConfiguration {
  implicit val jsonFormat: OFormat[ShardingCodecConfiguration] =
    Json.format[ShardingCodecConfiguration]
  val name = "sharding_indexed"
}

object CodecTreeExplorer {

  def findOne(condition: Function[CodecConfiguration, Boolean])(
      codecs: Seq[CodecConfiguration]): Option[CodecConfiguration] = {
    val results: Seq[Option[CodecConfiguration]] = codecs.map {
      case s: ShardingCodecConfiguration => {
        if (condition(s)) {
          Some(s)
        } else {
          findOne(condition)(s.codecs)
        }
      }
      case c: CodecConfiguration => Some(c).filter(condition)
    }
    results.flatten.headOption
  }
}
