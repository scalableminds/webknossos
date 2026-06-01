package com.scalableminds.util.objectid

import com.scalableminds.util.Msg
import com.scalableminds.util.tools.TextUtils.parseCommaSeparated
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import play.api.libs.json._
import play.api.mvc.{PathBindable, QueryStringBindable}
import reactivemongo.api.bson.BSONObjectID

import scala.concurrent.ExecutionContext

case class ObjectId(id: String) {
  override def toString: String = id
}

object ObjectId extends FoxImplicits {
  def generate: ObjectId = fromBsonId(BSONObjectID.generate())
  def fromString(literal: String)(implicit ec: ExecutionContext): Fox[ObjectId] =
    fromStringSync(literal).toFox ?~> Msg.ObjectId.invalid(literal)
  def fromCommaSeparated(idsStrOpt: Option[String])(implicit ec: ExecutionContext): Fox[List[ObjectId]] =
    parseCommaSeparated(idsStrOpt)(fromString)
  private def fromBsonId(bson: BSONObjectID) = ObjectId(bson.stringify)
  def fromStringSync(input: String): Option[ObjectId] =
    BSONObjectID.parse(input).map(fromBsonId).toOption

  // Accept human-readable prefix: anything-before-hyphen-<ObjectId>
  private def fromStringWithPrefixSync(input: String): Option[ObjectId] = {
    val objectIdCandidate = input.lastIndexOf('-') match {
      case -1  => input
      case idx => input.substring(idx + 1)
    }
    BSONObjectID.parse(objectIdCandidate).map(fromBsonId).toOption
  }

  def dummyId: ObjectId = ObjectId("000000000000000000000000")

  implicit object ObjectIdFormat extends Format[ObjectId] {
    override def reads(json: JsValue): JsResult[ObjectId] =
      json.validate[String].flatMap { idString =>
        val parsedOpt = fromStringSync(idString)
        parsedOpt match {
          case Some(parsed) => JsSuccess(parsed)
          case None         => JsError(Msg.ObjectId.invalid(idString))
        }
      }

    override def writes(o: ObjectId): JsValue = JsString(o.id)
  }

  implicit def pathBinder: PathBindable[ObjectId] =
    new PathBindable[ObjectId] {
      override def bind(key: String, value: String): Either[String, ObjectId] =
        fromStringWithPrefixSync(value).toRight(
          s"Cannot parse URI path parameter $key with value “$value” as ObjectId.")

      override def unbind(key: String, value: ObjectId): String = value.id
    }

  implicit def queryBinder: QueryStringBindable[ObjectId] =
    new QueryStringBindable[ObjectId] {
      override def bind(key: String, params: Map[String, Seq[String]]): Option[Either[String, ObjectId]] =
        params.get(key).flatMap(_.headOption).map { value =>
          fromStringSync(value).toRight(s"Cannot parse URI query parameter $key with value “$value” as ObjectId.")
        }

      override def unbind(key: String, value: ObjectId): String = value.id
    }
}
