package com.scalableminds.util.objectid

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
  def fromString(input: String)(implicit ec: ExecutionContext): Fox[ObjectId] =
    fromStringSync(input).toFox ?~> s"The passed resource id ‘$input’ is invalid"
  def fromCommaSeparated(idsStrOpt: Option[String])(implicit ec: ExecutionContext): Fox[List[ObjectId]] =
    parseCommaSeparated(idsStrOpt)(fromString)
  private def fromBsonId(bson: BSONObjectID) = ObjectId(bson.stringify)
  def fromStringSync(input: String): Option[ObjectId] = BSONObjectID.parse(input).map(fromBsonId).toOption
  def dummyId: ObjectId = ObjectId("000000000000000000000000")

  implicit object ObjectIdFormat extends Format[ObjectId] {
    override def reads(json: JsValue): JsResult[ObjectId] =
      json.validate[String].flatMap { idString =>
        val parsedOpt = fromStringSync(idString)
        parsedOpt match {
          case Some(parsed) => JsSuccess(parsed)
          case None         => JsError(f"bsonid.invalid: $idString")
        }
      }

    override def writes(o: ObjectId): JsValue = JsString(o.id)
  }

  implicit def pathBinder: PathBindable[ObjectId] =
    new PathBindable[ObjectId] {
      override def bind(key: String, value: String): Either[String, ObjectId] =
        fromStringSync(value).toRight(s"Cannot parse parameter $key as ObjectId: $value")

      override def unbind(key: String, value: ObjectId): String = value.id
    }

  implicit def queryBinder: QueryStringBindable[ObjectId] =
    new QueryStringBindable[ObjectId] {
      override def bind(key: String, params: Map[String, Seq[String]]): Option[Either[String, ObjectId]] =
        params.get(key).flatMap(_.headOption).map { value =>
          fromStringSync(value).toRight(s"Cannot parse parameter $key as ObjectId: $value")
        }

      override def unbind(key: String, value: ObjectId): String = value.id
    }
}
