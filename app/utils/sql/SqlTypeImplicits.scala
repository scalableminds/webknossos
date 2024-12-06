package utils.sql

import com.scalableminds.util.geometry.{BoundingBox, Vec3Double, Vec3Int}
import com.scalableminds.util.time.Instant
import play.api.libs.json.JsValue
import slick.jdbc.{GetResult, PositionedResult}
import com.scalableminds.util.objectid.ObjectId

import scala.concurrent.duration.FiniteDuration

trait SqlTypeImplicits {

  // reading typed results

  implicit protected object GetObjectId extends GetResult[ObjectId] {
    override def apply(v1: PositionedResult): ObjectId = ObjectId(v1.<<)
  }

  implicit protected object GetInstant extends GetResult[Instant] {
    override def apply(v1: PositionedResult): Instant = Instant.fromSql(v1.<<)
  }

  implicit protected object GetInstantOpt extends GetResult[Option[Instant]] {
    override def apply(v1: PositionedResult): Option[Instant] = v1.nextTimestampOption().map(Instant.fromSql)
  }

  implicit protected object GetByteArray extends GetResult[Array[Byte]] {
    override def apply(v1: PositionedResult): Array[Byte] = v1.nextBytes()
  }

  // Conversions of values to SqlValue

  implicit def stringToSqlValue(v: String): SqlValue = StringValue(v)

  implicit def booleanToSqlValue(v: Boolean): SqlValue = BooleanValue(v)

  implicit def shortToSqlValue(v: Short): SqlValue = ShortValue(v)

  implicit def intToSqlValue(v: Int): SqlValue = IntValue(v)

  implicit def longToSqlValue(v: Long): SqlValue = LongValue(v)

  implicit def floatToSqlValue(v: Float): SqlValue = FloatValue(v)

  implicit def doubleToSqlValue(v: Double): SqlValue = DoubleValue(v)

  implicit def enumToSqlValue(v: Enumeration#Value): SqlValue = EnumerationValue(v)

  implicit def objectIdToSqlValue(v: ObjectId): SqlValue = ObjectIdValue(v)

  implicit def instantToSqlValue(v: Instant): SqlValue = InstantValue(v)

  implicit def jsValueToSqlValue(v: JsValue): SqlValue = JsonValue(v)

  implicit def optionToSqlValue[T](v: Option[T])(implicit innerConversion: T => SqlValue): SqlValue =
    v match {
      case Some(inner) => innerConversion(inner)
      case None        => NoneValue()
    }

  implicit def stringIterableToSqlValue(v: Iterable[String]): SqlValue = StringArrayValue(v.toList)

  implicit def byteArrayToSqlValue(v: Array[Byte]): SqlValue = ByteArrayValue(v)

  implicit def boundingBoxToSqlValue(v: BoundingBox): SqlValue = BoundingBoxValue(v)

  implicit def vec3IntToSqlValue(v: Vec3Int): SqlValue = Vector3Value(v.toVec3Double)

  implicit def vec3DoubleToSqlValue(v: Vec3Double): SqlValue = Vector3Value(v)

  implicit def finiteDurationToSqlValue(v: FiniteDuration): SqlValue = DurationValue(v)

  // Conversions to SqlToken. This forwarded conversion is needed as implicits are not automatically chained.

  implicit def stringToSqlToken(v: String): SqlToken = stringToSqlValue(v).toSqlToken

  implicit def booleanToSqlToken(v: Boolean): SqlToken = booleanToSqlValue(v).toSqlToken

  implicit def shortToSqlToken(v: Short): SqlToken = shortToSqlValue(v).toSqlToken

  implicit def intToSqlToken(v: Int): SqlToken = intToSqlValue(v).toSqlToken

  implicit def longToSqlToken(v: Long): SqlToken = longToSqlValue(v).toSqlToken

  implicit def doubleToSqlToken(v: Double): SqlToken = doubleToSqlValue(v).toSqlToken

  implicit def floatToSqlToken(v: Float): SqlToken = floatToSqlValue(v).toSqlToken

  implicit def enumToSqlToken(v: Enumeration#Value): SqlToken = enumToSqlValue(v).toSqlToken

  implicit def objectIdToSqlToken(v: ObjectId): SqlToken = objectIdToSqlValue(v).toSqlToken

  implicit def instantToSqlToken(v: Instant): SqlToken = instantToSqlValue(v).toSqlToken

  implicit def jsValueToSqlToken(v: JsValue): SqlToken = jsValueToSqlValue(v).toSqlToken

  implicit def stringIterableToSqlToken(v: Iterable[String]): SqlToken = stringIterableToSqlValue(v).toSqlToken

  implicit def byteArrayToSqlToken(v: Array[Byte]): SqlToken = byteArrayToSqlValue(v).toSqlToken

  implicit def boundingBoxToSqlToken(v: BoundingBox): SqlToken = boundingBoxToSqlValue(v).toSqlToken

  implicit def vec3IntToSqlToken(v: Vec3Int): SqlToken = vec3IntToSqlValue(v).toSqlToken

  implicit def vec3DoubleToSqlToken(v: Vec3Double): SqlToken = vec3DoubleToSqlValue(v).toSqlToken

  implicit def finiteDurationToSqlToken(v: FiniteDuration): SqlToken = finiteDurationToSqlValue(v).toSqlToken

  implicit def sqlValueToSqlToken(v: SqlValue): SqlToken = v.toSqlToken

  implicit def optionToSqlToken[T](v: Option[T])(implicit innerConversion: T => SqlValue): SqlToken =
    optionToSqlValue(v).toSqlToken

  // Conversions to List and nested List, for SqlToken.tuple

  implicit def iterableToSqlValueList[T](v: Iterable[T])(implicit innerConversion: T => SqlValue): List[SqlValue] =
    v.map(innerConversion(_)).toList

  implicit def nestedIterableToSqlValueLists[T](v: Iterable[Iterable[T]])(
      implicit innerConversion: T => SqlValue): List[List[SqlValue]] =
    v.map(i => i.map(innerConversion(_)).toList).toList
}
