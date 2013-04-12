package controllers.levelcreator

import braingames.mvc._
import models.knowledge.Level
import play.api.mvc.{Action, Request, WrappedRequest, BodyParser, Result, BodyParsers}
import play.api.i18n.Messages

case class LevelRequest[T](val level: Level, val request: Request[T]) extends WrappedRequest(request)
  
class LevelCreatorController extends braingames.mvc.Controller {
  def ActionWithValidLevel[T](levelId: String, parser: BodyParser[T] = BodyParsers.parse.anyContent)
  (f: LevelRequest[T] => Result) = Action(parser){ 
    implicit request => 
    for {
      level <- Level.findOneById(levelId) ?~ Messages("level.notFound")
    } yield {
      f(LevelRequest(level, request))
    }
  }
}