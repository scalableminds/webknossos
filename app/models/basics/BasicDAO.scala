package models.basics

import com.mongodb.casbah.Imports._
import models.context._
import com.novus.salat.dao.SalatDAO
import play.api.libs.json.JsArray._
import play.api.libs.json._
import org.bson.types.ObjectId
import com.mongodb.casbah.MongoDB

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
    extends SalatDAO[T, ObjectId](collection = connection(collectionName)) {

  def findAll = find(MongoDBObject.empty).toList

  def findOneById(id: String): Option[T] = {
    if (ObjectId.isValid(id))
      findOneById(new ObjectId(id))
    else
      None
  }

  def insertOne(el: T): T = {
    super.insert(el)
    el
  }
}
