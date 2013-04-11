package controllers.levelcreator

import play.api.mvc.Action
import play.api.libs.concurrent.Akka
import play.api.Play.current
import braingames.levelcreator.StackWorkDistributor
import akka.util.Timeout
import akka.pattern.ask
import braingames.levelcreator.RequestWork
import scala.concurrent.duration._
import akka.pattern.AskTimeoutException
import play.api.Logger
import play.api.libs.concurrent.Execution.Implicits._
import braingames.levelcreator.StackGenerationChallenge
import models.knowledge.Stack
import play.api.libs.json.Json
import braingames.levelcreator.FinishWork

object WorkController extends LevelCreatorController {
  lazy val stackWorkDistributor = Akka.system.actorFor(s"user/${StackWorkDistributor.name}")

  implicit val requestWorkTimeout = Timeout(5 seconds)

  def request() = Action { implicit request =>
    Async {
      (stackWorkDistributor ? RequestWork())
        .recover {
          case e: AskTimeoutException =>
            Logger.warn("Stack request to stackWorkDistributor timed out!")
            None
        }
        .mapTo[Option[StackGenerationChallenge]].map { resultOpt =>
          resultOpt.map { result =>
            Ok(Stack.stackFormat.writes(result.challenge.stack) ++ Json.obj(
              "responseKey" -> result.responseKey))
          } getOrElse {
            BadRequest
          }
        }
    }
  }

  def finish(responseKey: String) = Action { implicit request =>
    stackWorkDistributor ! FinishWork(responseKey)
    Ok
  }
}