package com.scalableminds.webknossos.datastore.helpers

import com.scalableminds.util.box.Box
import com.scalableminds.util.box.Box.tryo
import play.api.libs.json.{Format, JsError, JsNumber, JsObject, JsString, JsSuccess, Reads, Writes}

/*
 * A Long that is assumed to always be unsigned, so uint64.
 * Since this only is an opaque type for Long to avoid a class wrapper,
 *  any arithmetic needs to be explicitly unsigned by the caller!
 * A custom JSON codec preserves the full uint64 range.
 * Writes object like {"customJsonEncoding": "bigint", "value": "<unsigned decimal>"}
 * Reads such objects again, but also plain numbers.
 */
opaque type UnsignedLong = Long

object UnsignedLong {
  def apply(value: Long): UnsignedLong = value

  extension (u: UnsignedLong) def toLong: Long = u

  def fromString(s: String): Box[UnsignedLong] = tryo(java.lang.Long.parseUnsignedLong(s))

  def toString(l: UnsignedLong): String = java.lang.Long.toUnsignedString(l)

  private val customEncodingKey = "customJsonEncoding"
  private val bigIntEncodingName = "bigint"

  private val jsonReads: Reads[UnsignedLong] = Reads {
    case obj: JsObject if (obj \ customEncodingKey).asOpt[String].contains(bigIntEncodingName) =>
      (obj \ "value").validate[String].flatMap { s =>
        UnsignedLong.fromString(s).map(JsSuccess(_)).getOrElse(JsError("error.expected.unsignedLongString"))
      }
    case JsNumber(n) => JsSuccess(UnsignedLong(n.toLong))
    case _           => JsError("error.expected.unsignedLongEnvelopeOrJsstringOrJsnumber")
  }

  private val jsonWrites: Writes[UnsignedLong] = Writes(l =>
    JsObject(
      Seq(
        customEncodingKey -> JsString(bigIntEncodingName),
        "value" -> JsString(UnsignedLong.toString(l))
      )
    )
  )

  implicit val jsonFormat: Format[UnsignedLong] = Format(jsonReads, jsonWrites)
}
