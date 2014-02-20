package models.basics

import braingames.reactivemongo.{UnsecuredMongoDAO, SecuredMongoDAO}
import play.modules.reactivemongo.ReactiveMongoPlugin
import play.api.Play
import reactivemongo.bson.BSONObjectID

import braingames.util.Fox
import scala.util.Success
import scala.concurrent.Future
import net.liftweb.common.Empty
import play.api.libs.concurrent.Execution.Implicits._

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 19.07.13
 * Time: 11:24
 */
trait SecuredBaseDAO[T] extends SecuredMongoDAO[T] with Implicits with MongoConnection {
  def withValidId[A](s: String)(f: BSONObjectID => Fox[A]): Fox[A] =
    BSONObjectID.parse(s) match {
      case Success(id) => f(id)
      case _ => Fox(Future.successful(Empty))
    }
}

trait UnsecuredBaseDAO[T] extends UnsecuredMongoDAO[T] with Implicits with MongoConnection

trait MongoConnection {
  implicit val application = Play.current

  val db = ReactiveMongoPlugin.db
}