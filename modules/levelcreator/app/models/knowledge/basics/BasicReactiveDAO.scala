package models.knowledge.basics

import braingames.reactivemongo.SecuredMongoDAO
import play.api.Play
import play.modules.reactivemongo.ReactiveMongoPlugin

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 19.07.13
 * Time: 11:24
 */
trait BasicReactiveDAO[T] extends SecuredMongoDAO[T]{
  implicit val application = Play.current
  val db = ReactiveMongoPlugin.db
}
