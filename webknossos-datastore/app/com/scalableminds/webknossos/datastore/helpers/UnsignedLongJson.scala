package com.scalableminds.webknossos.datastore.helpers

import play.api.libs.json.{Format, JsError, JsNumber, JsObject, JsString, JsSuccess, Reads, Writes}

import scala.util.Try

/*
 * JSON codec for Long, supporting full uint64 range.
 * Writes object like {"customJsonEncoding": "bigint", "value": "<unsigned decimal>"}
 * Reads such objects again, but also plain numbers.
 *
 * deliberately NOT an implicit Format[Long], otherwise *every* Long field would be formatted like this.
 * Use UnsignedLong or the Format explicitly where needed.
 *
 */
object UnsignedLongJson {

  val customEncodingKey = "customJsonEncoding"
  val bigIntEncodingName = "bigint"

  val reads: Reads[Long] = Reads {
    case obj: JsObject if (obj \ customEncodingKey).asOpt[String].contains(bigIntEncodingName) =>
      (obj \ "value").validate[String].flatMap { s =>
        Try(java.lang.Long.parseUnsignedLong(s))
          .map(JsSuccess(_))
          .getOrElse(JsError("error.expected.unsignedLongString"))
      }
    case JsString(s) =>
      Try(java.lang.Long.parseUnsignedLong(s)).map(JsSuccess(_)).getOrElse(JsError("error.expected.unsignedLongString"))
    case JsNumber(n) => JsSuccess(n.toLong)
    case _           => JsError("error.expected.unsignedLongEnvelopeOrJsstringOrJsnumber")
  }

  val writes: Writes[Long] = Writes(l =>
    JsObject(
      Seq(
        customEncodingKey -> JsString(bigIntEncodingName),
        "value" -> JsString(java.lang.Long.toUnsignedString(l))
      )
    )
  )

  val format: Format[Long] = Format(reads, writes)
}

/*
 * A Long that is JSON-(de)serialized via UnsignedLongJson instead of the default JsNumber
 * encoding. Giving id fields this distinct type (instead of plain Long) lets ordinary
 * Json.format[X] macro derivation pick up the right codec automatically, instead of having to
 * hand-write a Format for every case class that has an id field.
 *
 * The name reflects the unsigned-decimal *wire encoding* (java.lang.Long.toUnsignedString /
 * parseUnsignedLong, an exact bijection over the full 64-bit space), not a claim that the
 * wrapped value is non-negative -- a signed int64 id (or, once allowed, a negative int32/16/8
 * id) round-trips through this encoding exactly, bit pattern preserved either way.
 *
 * Deliberately has no arithmetic/Ordering/Numeric instance: this type exists only for the JSON
 * boundary. Internal domain/service logic should keep using plain Long, converting with
 * .toLong/UnsignedLong(...) right at the point where a case class using this type is
 * constructed or consumed.
 */
opaque type UnsignedLong = Long

object UnsignedLong {
  def apply(value: Long): UnsignedLong = value

  extension (u: UnsignedLong) def toLong: Long = u

  implicit val jsonFormat: Format[UnsignedLong] =
    Format(UnsignedLongJson.reads.map(apply), UnsignedLongJson.writes.contramap(_.toLong))
}
