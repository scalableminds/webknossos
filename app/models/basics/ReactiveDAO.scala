package models.basics

import com.scalableminds.util.reactivemongo.{SecuredMongoDAO, UnsecuredMongoDAO}
import com.scalableminds.util.tools.Fox
import net.liftweb.common.Empty
import play.modules.reactivemongo.ReactiveMongoApi
import reactivemongo.bson.BSONObjectID

import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.Future
import scala.util.Success

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 19.07.13
 * Time: 11:24
 */
trait SecuredBaseDAO[T] extends SecuredMongoDAO[T] with Implicits with StaticReactiveMongoMixin{
  def withValidId[A](s: String)(f: BSONObjectID => Fox[A]): Fox[A] =
    BSONObjectID.parse(s) match {
      case Success(id) => f(id)
      case _ => Fox(Future.successful(Empty))
    }

  lazy val db = reactiveMongoApi.db
}

trait UnsecuredBaseDAO[T] extends UnsecuredMongoDAO[T] with Implicits with StaticReactiveMongoMixin{
  lazy val db = reactiveMongoApi.db
}


trait StaticReactiveMongoMixin{
  // TODO: this needs fixing. Instead of accessing the db instance this way, it should
  // be injected into the models by the controler using them
  lazy val reactiveMongoApi = play.api.Play.current.injector.instanceOf[ReactiveMongoApi]
}
