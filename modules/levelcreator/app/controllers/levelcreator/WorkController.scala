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
import models.knowledge._
import play.api.libs.json._
import braingames.levelcreator.FinishedWork
import braingames.levelcreator.FailedWork
import braingames.levelcreator.CountActiveRenderers
import play.api.mvc.BodyParsers._

object WorkController extends LevelCreatorController {
  lazy val stackWorkDistributor = Akka.system.actorFor(s"user/${StackWorkDistributor.name}")

  implicit val requestWorkTimeout = Timeout(5 seconds)
  
  def countActiveRenderers = {
    (stackWorkDistributor ? CountActiveRenderers).mapTo[Int].map(Some.apply).recover {
      case e => 
        Logger.warn("Couldn't cound renderers because of: " + e)
        None
    }
  }

  def request(rendererId: String) = Action { implicit request =>
    Async {
      (stackWorkDistributor ? RequestWork(rendererId))
        .recover {
          case e: AskTimeoutException =>
            Logger.warn("Stack request to stackWorkDistributor timed out!")
            None
        }
        .mapTo[Option[Stack]].map { resultOpt =>
          resultOpt.map { result =>
            Ok(Stack.stackFormat.writes(result))
          } getOrElse {
            NoContent
          }
        }
    }
  }

  def finished(key: String) = Action(parse.text) { implicit request =>
    val downloadUrls = request.body.split(" ").toList
    stackWorkDistributor ! FinishedWork(key, downloadUrls)
    Ok
  }

  def failed(key: String) = Action { implicit request =>
    stackWorkDistributor ! FailedWork(key)
    Ok
  }
}