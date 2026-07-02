package com.scalableminds.webknossos.datastore.helpers

import play.api.libs.json.{
  Format,
  JsArray,
  JsError,
  JsNull,
  JsNumber,
  JsObject,
  JsResult,
  JsString,
  JsSuccess,
  JsValue,
  OFormat,
  Reads,
  Writes
}

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
      Try(java.lang.Long.parseUnsignedLong(s))
        .map(JsSuccess(_))
        .getOrElse(JsError("error.expected.unsignedLongString"))
    case JsNumber(n) => JsSuccess(n.toLong)
    case _           => JsError("error.expected.jsstringOrJsnumber")
  }

  val writes: Writes[Long] = Writes(l => JsString(java.lang.Long.toUnsignedString(l)))

  val format: Format[Long] = Format(reads, writes)

  /*
   * Overrides a single required Long field of an existing (typically macro-derived) OFormat to use
   * unsigned-decimal string encoding, without having to hand-write Reads/Writes for every other field.
   * The field is temporarily replaced with a placeholder while delegating to the base format, so that
   * unrelated fields (including other Long fields, e.g. timestamps) keep their normal JsNumber encoding.
   */
  def patchRequiredField[A](base: OFormat[A], field: String)(get: A => Long, set: (A, Long) => A): OFormat[A] =
    new OFormat[A] {
      override def writes(a: A): JsObject = base.writes(a) ++ JsObject(Seq(field -> UnsignedLongJson.writes.writes(get(a))))
      override def reads(json: JsValue): JsResult[A] =
        for {
          value <- (json \ field).validate[Long](using UnsignedLongJson.reads)
          patchedJson <- json.validate[JsObject].map(_ + (field -> JsNumber(0)))
          baseResult <- base.reads(patchedJson)
        } yield set(baseResult, value)
    }

  /* Same as patchRequiredField, but for an optional Long field (e.g. largestSegmentId). */
  def patchOptionalField[A](base: OFormat[A],
                             field: String)(get: A => Option[Long], set: (A, Option[Long]) => A): OFormat[A] =
    new OFormat[A] {
      override def writes(a: A): JsObject =
        base.writes(a) ++ get(a)
          .map(v => JsObject(Seq(field -> UnsignedLongJson.writes.writes(v))))
          .getOrElse(JsObject(Seq.empty))
      override def reads(json: JsValue): JsResult[A] =
        for {
          value <- (json \ field).toOption match {
            case None | Some(JsNull) => JsSuccess(None)
            case Some(v)             => v.validate[Long](using UnsignedLongJson.reads).map(Some(_))
          }
          patchedJson <- json.validate[JsObject].map(_ - field)
          baseResult <- base.reads(patchedJson)
        } yield set(baseResult, value)
    }

  /* Same as patchRequiredField, but for a required List[Long] field (e.g. a list of segment ids). */
  def patchListField[A](base: OFormat[A],
                         field: String)(get: A => List[Long], set: (A, List[Long]) => A): OFormat[A] =
    new OFormat[A] {
      override def writes(a: A): JsObject =
        base.writes(a) ++ JsObject(Seq(field -> JsArray(get(a).map(UnsignedLongJson.writes.writes))))
      override def reads(json: JsValue): JsResult[A] =
        for {
          values <- (json \ field).validate[List[Long]](using Reads.list(using UnsignedLongJson.reads))
          patchedJson <- json.validate[JsObject].map(_ + (field -> JsArray()))
          baseResult <- base.reads(patchedJson)
        } yield set(baseResult, values)
    }

  /* Same as patchListField, but for a required Seq[Long] field. */
  def patchSeqField[A](base: OFormat[A], field: String)(get: A => Seq[Long], set: (A, Seq[Long]) => A): OFormat[A] =
    new OFormat[A] {
      override def writes(a: A): JsObject =
        base.writes(a) ++ JsObject(Seq(field -> JsArray(get(a).map(UnsignedLongJson.writes.writes))))
      override def reads(json: JsValue): JsResult[A] =
        for {
          values <- (json \ field).validate[Seq[Long]](using Reads.seq(using UnsignedLongJson.reads))
          patchedJson <- json.validate[JsObject].map(_ + (field -> JsArray()))
          baseResult <- base.reads(patchedJson)
        } yield set(baseResult, values)
    }
}
