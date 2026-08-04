package com.scalableminds.webknossos.datastore.helpers

import play.api.libs.json.{Format, JsError, JsNumber, JsString, JsSuccess, Reads, Writes}

import scala.util.Try

/*
 * JSON codec for Long fields that hold uint64 ids (segment/agglomerate ids), which need
 * unsigned-decimal string encoding to be representable in JSON without precision loss.
 * This is deliberately NOT an implicit Format[Long], since Json.format[X] macros would then
 * silently reinterpret *every* Long field of every case class (timestamps, versions, ...) as a
 * string. Apply `format` explicitly to the specific id fields that need it.
 *
 * Reading accepts both the new JsString (unsigned-decimal) encoding and the legacy plain
 * JsNumber encoding. The legacy JsNumber path is permanent, not a migration-window shim:
 * update actions using it are persisted indefinitely and replayed for undo/redo/history.
 */
object UnsignedLongJson {

  val reads: Reads[Long] = Reads {
    case JsString(s) =>
      Try(java.lang.Long.parseUnsignedLong(s)).map(JsSuccess(_)).getOrElse(JsError("error.expected.unsignedLongString"))
    case JsNumber(n) => JsSuccess(n.toLong)
    case _           => JsError("error.expected.jsstringOrJsnumber")
  }

  val writes: Writes[Long] = Writes(l => JsString(java.lang.Long.toUnsignedString(l)))

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

/*
 * Unlike UnsignedLong above (JSON boundary only), these operate on plain Long values as used
 * in internal domain/service logic. A uint64 id >= 2^63 is negative as a signed Long, so
 * ordinary <, >, Math.max, Math.min silently pick the wrong value once the sign bit is set.
 * java.lang.Long.compareUnsigned agrees with signed comparison whenever both values are
 * < 2^63 (i.e. always, for every non-uint64 element class), so these are safe to use
 * unconditionally for any Long that represents a segment/agglomerate id, regardless of
 * element class.
 */
object UnsignedLongOps {
  def maxUnsigned(a: Long, b: Long): Long = if (java.lang.Long.compareUnsigned(a, b) >= 0) a else b
  def minUnsigned(a: Long, b: Long): Long = if (java.lang.Long.compareUnsigned(a, b) <= 0) a else b
}
