package com.scalableminds.webknossos.datastore.datareaders.zarr3

import com.scalableminds.util.box.Box
import com.scalableminds.util.enumeration.ExtendedEnumeration
import com.scalableminds.util.tools.ByteUtils
import com.scalableminds.webknossos.datastore.datareaders.{
  ArrayDataType,
  BloscCompressor,
  BoolCompressionSetting,
  CompressionSetting,
  GzipCompressor,
  IntCompressionSetting,
  MultiArrayUtils,
  StringCompressionSetting,
  ZstdCompressor
}
import com.scalableminds.webknossos.datastore.datareaders.ArrayDataType.ArrayDataType
import com.scalableminds.webknossos.datastore.helpers.JsonImplicits
import com.typesafe.scalalogging.LazyLogging
import play.api.libs.json.{Format, JsObject, JsResult, JsString, JsSuccess, JsValue, Json, OFormat, Reads, Writes}
import play.api.libs.json.Json.WithDefaultValues
import ucar.ma2.{IndexIterator, Array as MultiArray}

import java.util.zip.CRC32C

sealed trait TransposeSetting
final case class StringTransposeSetting(order: String) extends TransposeSetting
final case class IntArrayTransposeSetting(order: Array[Int]) extends TransposeSetting

object TransposeSetting {
  implicit object TransposeSettingFormat extends Format[TransposeSetting] {

    override def reads(json: JsValue): JsResult[TransposeSetting] =
      json
        .validate[String]
        .map(StringTransposeSetting(_))
        .orElse(json.validate[Array[Int]].map(IntArrayTransposeSetting(_)))

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

// Element-wise arithmetic on MultiArrays that honors the signedness of the (zarr) data type.
// ucar.ma2 stores unsigned types in signed primitives, so unsigned values must be masked when read.
private object ArrayCodecMath {

  def getAsDouble(iter: IndexIterator, dataType: ArrayDataType): Double = dataType match {
    case ArrayDataType.u1 => (iter.getByteNext & 0xff).toDouble
    case ArrayDataType.u2 => (iter.getShortNext & 0xffff).toDouble
    case ArrayDataType.u4 => (iter.getIntNext.toLong & 0xffffffffL).toDouble
    case ArrayDataType.u8 =>
      val l = iter.getLongNext
      if (l >= 0) l.toDouble else l.toDouble + 18446744073709551616.0 // + 2^64
    case ArrayDataType.i1   => iter.getByteNext.toDouble
    case ArrayDataType.i2   => iter.getShortNext.toDouble
    case ArrayDataType.i4   => iter.getIntNext.toDouble
    case ArrayDataType.i8   => iter.getLongNext.toDouble
    case ArrayDataType.f4   => iter.getFloatNext.toDouble
    case ArrayDataType.f8   => iter.getDoubleNext
    case ArrayDataType.bool => if (iter.getBooleanNext) 1.0 else 0.0
  }

  // Writes value into the target element, rounding and clamping into range for integer targets.
  // The primitive truncation (e.g. .toByte) yields the correct little-endian bit pattern for unsigned targets.
  def setFromDouble(iter: IndexIterator, dataType: ArrayDataType, value: Double): Unit = dataType match {
    case ArrayDataType.f8 => iter.setDoubleNext(value)
    case ArrayDataType.f4 => iter.setFloatNext(value.toFloat)
    case _                =>
      val clamped = clampToRange(Math.rint(value), dataType)
      dataType match {
        case ArrayDataType.i1 | ArrayDataType.u1 => iter.setByteNext(clamped.toLong.toByte)
        case ArrayDataType.i2 | ArrayDataType.u2 => iter.setShortNext(clamped.toLong.toShort)
        case ArrayDataType.i4 | ArrayDataType.u4 => iter.setIntNext(clamped.toLong.toInt)
        case ArrayDataType.i8 | ArrayDataType.u8 => iter.setLongNext(clamped.toLong)
        case ArrayDataType.bool                  => iter.setBooleanNext(clamped != 0.0)
        case _                                   => iter.setDoubleNext(value)
      }
  }

  private def clampToRange(value: Double, dataType: ArrayDataType): Double = {
    val min = ArrayDataType.minValue(dataType).doubleValue
    val max = ArrayDataType.maxValue(dataType).doubleValue
    Math.max(min, Math.min(max, value))
  }

  // Maps each element of source (interpreted as sourceDataType) through f, writing into a fresh
  // MultiArray of targetDataType with the same shape and (C-)order.
  def mapElements(source: MultiArray, sourceDataType: ArrayDataType, targetDataType: ArrayDataType)(
      f: Double => Double
  ): MultiArray = {
    val target = MultiArray.factory(MultiArrayUtils.toMADataType(targetDataType), source.getShape)
    val sourceIter = source.getIndexIterator
    val targetIter = target.getIndexIterator
    while (sourceIter.hasNext)
      setFromDouble(targetIter, targetDataType, f(getAsDouble(sourceIter, sourceDataType)))
    target
  }
}

// https://github.com/zarr-developers/zarr-extensions/tree/main/codecs/reshape
// Reshape preserves the C-order (lexicographical) ravel of the elements. Since chunks are typed
// directly into their logical chunk shape, decoding is a no-op here (analogous to the transpose codec).
class ReshapeCodec extends ArrayToArrayCodec {
  override def encode(array: MultiArray): MultiArray = ???
  override def decode(array: MultiArray): MultiArray = array
}

// https://github.com/zarr-developers/zarr-extensions/tree/main/codecs/scale_offset
// Decode: out = in / scale + offset, performed in the array's own data type (dtype-preserving).
class ScaleOffsetCodec(offset: Double, scale: Double, dataType: ArrayDataType) extends ArrayToArrayCodec {
  override def encode(array: MultiArray): MultiArray = ???
  override def decode(array: MultiArray): MultiArray =
    ArrayCodecMath.mapElements(array, dataType, dataType)(in => in / scale + offset)
}

// https://github.com/zarr-developers/zarr-extensions/tree/main/codecs/cast_value
// Decode: reinterpret the stored (encoded) values as the logical array data type.
// rounding/out_of_range/scalar_map primarily describe the (lossy) encode direction; on decode we
// convert exactly, clamping into range as a safeguard (best-effort support).
class CastValueCodec(sourceDataType: ArrayDataType, targetDataType: ArrayDataType) extends ArrayToArrayCodec {
  override def encode(array: MultiArray): MultiArray = ???
  override def decode(array: MultiArray): MultiArray =
    ArrayCodecMath.mapElements(array, sourceDataType, targetDataType)(identity)
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

object BloscCodec {
  def fromConfiguration(configuration: BloscCodecConfiguration): BloscCodec =
    new BloscCodec(
      configuration.cname,
      configuration.clevel,
      configuration.shuffle,
      configuration.typesize,
      configuration.blocksize
    )
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

class ShardingCodec(
    val chunk_shape: Array[Int],
    val codecs: Seq[CodecConfiguration],
    val index_codecs: Seq[CodecConfiguration],
    val index_location: IndexLocationSetting.IndexLocationSetting = IndexLocationSetting.end
) extends ArrayToBytesCodec {

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
final case class BloscCodecConfiguration(
    cname: String,
    clevel: Int,
    shuffle: CompressionSetting,
    typesize: Option[Int],
    blocksize: Int
) extends CodecConfiguration {
  override def name: String = BloscCodecConfiguration.name
}

object BloscCodecConfiguration {
  implicit val jsonFormat: OFormat[BloscCodecConfiguration] = Json.format[BloscCodecConfiguration]
  val name = "blosc"

  private def shuffleSettingFromInt(shuffle: Int): String = shuffle match {
    case 0 => "noshuffle"
    case 1 => "shuffle"
    case 2 => "bitshuffle"
    case _ => ???
  }

  lazy val defaultForWKZarrOutput: BloscCodecConfiguration =
    BloscCodecConfiguration(
      BloscCompressor.defaultCname.getValue,
      BloscCompressor.defaultCLevel,
      StringCompressionSetting(BloscCodecConfiguration.shuffleSettingFromInt(BloscCompressor.defaultShuffle.getValue)),
      Some(BloscCompressor.defaultTypesize),
      BloscCompressor.defaultBlocksize
    )
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

final case class ReshapeCodecConfiguration(shape: JsValue) extends CodecConfiguration {
  override def name: String = ReshapeCodecConfiguration.name
}
object ReshapeCodecConfiguration {
  implicit val jsonFormat: OFormat[ReshapeCodecConfiguration] = Json.format[ReshapeCodecConfiguration]
  val name = "reshape"
}

final case class ScaleOffsetCodecConfiguration(offset: Option[Double], scale: Option[Double])
    extends CodecConfiguration {
  override def name: String = ScaleOffsetCodecConfiguration.name
}
object ScaleOffsetCodecConfiguration {
  implicit val jsonFormat: OFormat[ScaleOffsetCodecConfiguration] = Json.format[ScaleOffsetCodecConfiguration]
  val name = "scale_offset"
}

final case class CastValueCodecConfiguration(
    data_type: String,
    rounding: Option[String],
    out_of_range: Option[String],
    scalar_map: Option[JsObject]
) extends CodecConfiguration {
  override def name: String = CastValueCodecConfiguration.name
}
object CastValueCodecConfiguration {
  implicit val jsonFormat: OFormat[CastValueCodecConfiguration] = Json.format[CastValueCodecConfiguration]
  val name = "cast_value"
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

final case class ShardingCodecConfiguration(
    chunk_shape: Array[Int],
    codecs: Seq[CodecConfiguration],
    index_codecs: Seq[CodecConfiguration],
    index_location: IndexLocationSetting.IndexLocationSetting = IndexLocationSetting.end
) extends CodecConfiguration {
  override def name: String = ShardingCodecConfiguration.name
  def isSupported: Box[Unit] =
    for {
      _ <- Box.fromBool(index_codecs.size <= 2) ?~> s"Maximum of 2 index codecs supported, got ${index_codecs.size}"
      _ <- Box.fromBool(
        index_codecs.count(_.name == "bytes") == 1
      ) ?~> s"Exactly one bytes codec supported, got ${index_codecs.count(_.name == "bytes")}"
      _ <- Box.fromBool(
        index_codecs.count(_.name == "crc32c") <= 1
      ) ?~> s"Maximum of 1 crc32c codec supported, got ${index_codecs.count(_.name == "crc32c")}"
    } yield ()

}

object ShardingCodecConfiguration {
  implicit val jsonFormat: OFormat[ShardingCodecConfiguration] =
    Json.format[ShardingCodecConfiguration]
  val name = "sharding_indexed"
}

object CodecTreeExplorer {

  def findOne(
      condition: Function[CodecConfiguration, Boolean]
  )(codecs: Seq[CodecConfiguration]): Option[CodecConfiguration] = {
    val results: Seq[Option[CodecConfiguration]] = codecs.map {
      case s: ShardingCodecConfiguration =>
        if (condition(s)) {
          Some(s)
        } else {
          findOne(condition)(s.codecs)
        }
      case c: CodecConfiguration => Some(c).filter(condition)
    }
    results.flatten.headOption
  }
}
