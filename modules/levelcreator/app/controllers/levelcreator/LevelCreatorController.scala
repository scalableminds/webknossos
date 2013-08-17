package controllers.levelcreator

import models.knowledge.{LevelDAO, Level}
import play.api.mvc.{Action, Request, WrappedRequest, BodyParser, Result, BodyParsers}
import play.api.i18n.Messages
import play.api.libs.concurrent.Execution.Implicits._
import braingames.reactivemongo.GlobalDBAccess
import braingames.mvc.ExtendedController
import play.api.mvc._

case class LevelRequest[T](val level: Level, val request: Request[T]) extends WrappedRequest(request)

class LevelCreatorController extends ExtendedController with Controller with GlobalDBAccess {
  def ActionWithValidLevel[T](levelId: String, parser: BodyParser[T] = BodyParsers.parse.anyContent)
    (f: LevelRequest[T] => Result) = Action(parser) {
    implicit request =>
      Async {
        for {
          level <- LevelDAO.findOneById(levelId) ?~> Messages("level.notFound")
        } yield {
          f(LevelRequest(level, request))
        }
      }
  }
}