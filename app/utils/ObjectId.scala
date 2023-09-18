package utils

import com.scalableminds.util.tools.{Fox, FoxImplicits}
import play.api.libs.json._
import reactivemongo.api.bson.BSONObjectID

import scala.concurrent.ExecutionContext

case class ObjectId(id: String) {
  override def toString: String = id
}

object ObjectId extends FoxImplicits {
  def generate: ObjectId = fromBsonId(BSONObjectID.generate())
  def fromString(input: String)(implicit ec: ExecutionContext): Fox[ObjectId] =
    fromStringSync(input).toFox ?~> s"The passed resource id ‘$input’ is invalid"
  private def fromBsonId(bson: BSONObjectID) = ObjectId(bson.stringify)
  private def fromStringSync(input: String) = BSONObjectID.parse(input).map(fromBsonId).toOption
  def dummyId: ObjectId = ObjectId("dummyObjectId")

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
}
