package models.basics

import braingames.reactivemongo.SecuredMongoDAO
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
trait BasicReactiveDAO[T] extends SecuredMongoDAO[T]{
  implicit val application = Play.current

  implicit def toBSONObjectID(o: ObjectId) =
    BSONObjectID(o.toString)

  val db = ReactiveMongoPlugin.db
}
