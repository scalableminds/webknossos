package controllers.levelcreator

import akka.pattern.ask
import akka.routing.RoundRobinRouter
import play.api.libs.concurrent._
import scala.concurrent.duration._
import scala.concurrent._
import ExecutionContext.Implicits.global
import akka.actor._
import akka.util.Timeout
import akka.pattern.AskTimeoutException
import play.api.Play.current
import play.api.libs.json._
import play.api.i18n.Messages
import play.api._
import braingames.levelcreator._
import views._
import models.knowledge._
import play.api.mvc.Action
import reactivemongo.bson.BSONObjectID
import reactivemongo.core.commands.LastError

object StackController extends LevelCreatorController {

  val conf = Play.current.configuration

  lazy val stackWorkDistributor = Akka.system.actorFor(s"user/${StackWorkDistributor.name}")

  def list(levelName: String) = Action {
    implicit request =>
      Async {
        LevelDAO.findByName(levelName).flatMap(l => Future.traverse(l) {
          level =>
            RenderedStackDAO.findFor(level.levelId).map {
              rendered =>
                level -> rendered
            }
        }).map {
          renderedMap =>
            Ok(html.levelcreator.stackList(renderedMap))
        }
      }
  }

  def listJson(levelId: String) = ActionWithValidLevel(levelId) {
    implicit request =>
      Async {
        for {
          rendered <- RenderedStackDAO.findFor(request.level.levelId)
        } yield {
          Ok(Json.toJson(rendered.map(_.mission.id)))
        }
      }
  }

  def cleanDeleteOfRenderedStack(renderedStack: RenderedStack): Future[LastError] = {
    cleanDeleteOfRenderedStack(renderedStack.levelId, renderedStack.mission._id)
  }

  def cleanDeleteOfRenderedStack(levelId: LevelId, _mission: BSONObjectID) = {
    MissionDAO.findOneById(_mission).map {
      case Some(mission) if !mission.isFinished =>
        LevelDAO.decreaseNumberOfActiveStacks(levelId)
      case _ =>
    }.flatMap {
      _ =>
        MissionDAO.deleteRendered(levelId, _mission)
    }
  }

  def delete(levelId: String, missionId: String) = ActionWithValidLevel(levelId) {
    implicit request =>
      Async {
        val level = request.level
        for {
          _ <- RenderedStackDAO.remove(level.levelId, missionId) ?~> "Rendered stack couldn't be removed"
        } yield {
          BSONObjectID.parse(missionId).map(id => cleanDeleteOfRenderedStack(level.levelId, id))
          JsonOk(Messages("level.stack.removed"))
        }
      }
  }

  def deleteAll(levelId: String) = ActionWithValidLevel(levelId) {
    implicit request =>
      Async {
        RenderedStackDAO.findFor(request.level.levelId).map{
          renderedStacks =>
            renderedStacks.map(cleanDeleteOfRenderedStack)
        }.flatMap {
          _ =>
            RenderedStackDAO.removeAllOf(request.level.levelId)
        }.map {
          _ =>
            JsonOk(Messages("level.stack.removedAll"))
        }
      }
  }

  /*def create(level: Level, missions: Seq[Mission]) = {
    stackWorkDistributor ! CreateStacks(missions.map(m => Stack(level, m)))
    JsonOk("Creation is in progress.")
  } */

  def create(level: Level, num: Int) = {
    stackWorkDistributor ! CreateRandomStacks(level, num)
    JsonOk("Creation is in progress.")
  }

  def produce(levelId: String, count: Int) = ActionWithValidLevel(levelId) {
    implicit request =>
      create(request.level, count)
  }

  /*def produceBulk(levelId: String) = ActionWithValidLevel(levelId, parse.urlFormEncoded) {
    implicit request =>
      Async {
        for {
          missionIds <- postParameterList("missionId") ?~> Messages("mission.startId.missing")
          missions <- Future.traverse(missionIds)(MissionDAO.findOneById)
        } yield {
          create(request.level, missions.flatten)
        }
      }
  } */
}