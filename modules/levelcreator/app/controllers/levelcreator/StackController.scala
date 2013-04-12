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

object StackController extends LevelCreatorController {

  val conf = Play.current.configuration

  lazy val stackWorkDistributor = Akka.system.actorFor(s"user/${StackWorkDistributor.name}")

  def list(levelId: String) = ActionWithValidLevel(levelId) { implicit request =>
    val missions = for {
      missionId <- request.level.renderedMissions
      mission <- Mission.findOneById(missionId)
    } yield mission
    Ok(html.levelcreator.stackList(request.level, missions))
  }

  def listJson(levelId: String) = ActionWithValidLevel(levelId) { implicit request =>
    Ok(Json.toJson(request.level.renderedMissions))
  }

  def delete(levelId: String, missionId: String) = ActionWithValidLevel(levelId) { implicit request =>
    request.level.removeRenderedMission(missionId)
    JsonOk(Messages("level.stack.removed"))
  }

  def deleteAll(levelId: String) = ActionWithValidLevel(levelId) { implicit request =>
    request.level.removeAllRenderedMissions
    JsonOk(Messages("level.stack.removedAll"))
  }

  def create(level: Level, missions: List[Mission]) = {
    implicit val timeout = Timeout((1000 * missions.size) seconds)
    stackWorkDistributor ! CreateStacks(missions.map(m => Stack(level, m)))
    JsonOk("Creation is in progress.")
  }

  def produce(levelId: String, count: Int) = ActionWithValidLevel(levelId) { implicit request =>
    val missions = Mission.findByDataSetName(request.level.dataSetName).
      filterNot(m => request.level.renderedMissions.contains(m.id))

    create(request.level, missions.take(count))
  }

  def produceAll(levelId: String) = ActionWithValidLevel(levelId) { implicit request =>
    val missions = Mission.findByDataSetName(request.level.dataSetName).toList
    create(request.level, missions)
  }

  def produceBulk(levelId: String) = ActionWithValidLevel(levelId, parse.urlFormEncoded) { implicit request =>
    for {
      missionIds <- postParameterList("missionId") ?~ Messages("mission.startId.missing")
      missions = missionIds.flatMap(Mission.findOneById).toList
    } yield {
      create(request.level, missions)
    }
  }

}