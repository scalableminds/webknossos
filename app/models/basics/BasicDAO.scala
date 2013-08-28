package models.basics

import com.mongodb.casbah.Imports._
import models.context._
import com.novus.salat.dao.SalatDAO
import play.api.libs.json._
import org.bson.types.ObjectId
import com.mongodb.casbah.MongoDB
import reactivemongo.bson.{BSONValue}
import play.modules.reactivemongo.json.BSONFormats.PartialFormat

trait Persistence

/**
 * scalableminds - brainflight
 * User: tmbo
 * Date: 11.12.11
 * Time: 12:35
 */

/**
 * Basis for all mapper objects
 */
class BasicDAO[T <: AnyRef](collectionName: String, connection: MongoDB = DB.connection)(implicit val m: Manifest[T])
    extends SalatDAO[T, ObjectId](collection = connection(collectionName)) with BasicDAOFormats{

  def findAll = find(MongoDBObject.empty).toList

  def removeAll() = 
    remove(MongoDBObject.empty)
  
  def findOneById(id: String): Option[T] = {
    withValidId(id){ id =>
      findOneById(id)
    }
  }

  def withValidId[A](id: String)(f: ObjectId => Option[A]): Option[A] = {
    if (ObjectId.isValid(id))
     f(new ObjectId(id))
    else
      None
  }

  def insertOne(el: T): T = {
    super.insert(el)
    el
  }
}

trait BasicDAOFormats{
  implicit object ObjectIdFormat extends Format[ObjectId] {

    def reads(json: JsValue) = json match {
      case JsObject(("$oid", JsString(v)) +: Nil) if ObjectId.isValid(v) =>
        JsSuccess(new ObjectId(v))
      case _ =>
        JsError("Invalid ObjectId object")
    }

    def writes(objectId: ObjectId) = {
      Json.obj("$oid" -> objectId.toString)
    }
  }
}