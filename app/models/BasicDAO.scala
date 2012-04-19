package models

import com.mongodb.casbah.Imports._
import models.context._
import com.novus.salat.dao.SalatDAO
import play.api.Play
import play.api.Play.current
import play.api.libs.json.JsArray._
import play.api.libs.json._

/**
 * scalableminds - brainflight
 * User: tmbo
 * Date: 11.12.11
 * Time: 12:35
 */

/**
 * Basis for all mapper objects
 */
class BasicDAO[T <: AnyRef](collectionName:String)(implicit val m: Manifest[T])
  extends SalatDAO[T, ObjectId](collection = DB.connection(collectionName)){
  def findAll = find( MongoDBObject.empty ).toList  
}
