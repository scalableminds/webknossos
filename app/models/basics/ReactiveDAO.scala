package models.basics

import braingames.reactivemongo.{UnsecuredMongoDAO, SecuredMongoDAO}
import play.modules.reactivemongo.ReactiveMongoPlugin
import play.api.Play
import com.mongodb.casbah.Imports.ObjectId
import reactivemongo.bson.BSONObjectID

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 19.07.13
 * Time: 11:24
 */
trait SecuredBaseDAO[T] extends SecuredMongoDAO[T] with Implicits with MongoConnection

trait UnsecuredBaseDAO[T] extends UnsecuredMongoDAO[T] with Implicits with MongoConnection

trait MongoConnection{
  implicit val application = Play.current

  val db = ReactiveMongoPlugin.db
}