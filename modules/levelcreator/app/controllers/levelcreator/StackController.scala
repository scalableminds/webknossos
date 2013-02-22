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
import models.knowledge.{Level, Mission}

object StackController extends LevelCreatorController{
  
  val levelCreateRouter = Akka.system.actorOf(Props[LevelCreateActor].withRouter(RoundRobinRouter(nrOfInstances = 4)),
      name = "LevelCreateRouter")
      
  def list(levelId: String) = ActionWithValidLevel(levelId) { implicit request =>
      val missions = for{missionId <- request.level.renderedMissions
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
  
  def create(level: Level, missions: List[Mission]) = {
    println(missions)
    implicit val timeout = Timeout((100 * missions.size) seconds)
    val future = Future.traverse(missions)(m => ask(levelCreateRouter, CreateLevel(level, m))).recover {
      case e: AskTimeoutException =>
        Logger.error("stack creation timed out")
        Messages("level.stack.creationTimeout")
        List()
    }
    future.mapTo[List[Option[Mission]]].map { ms => 
      val renderedMissions = ms.flatten
      level.addRenderedMissions(renderedMissions.map(_.id))
      JsonOk(s"created ${renderedMissions.map(m => (m.id.takeRight(6))).mkString("\n")}") 
    } 
  }

  def produce(levelId: String, count: Int) = ActionWithValidLevel(levelId) { implicit request =>
    Async {
      val missions = Mission.findByDataSetName(request.level.dataSetName).
          filterNot(m => request.level.renderedMissions.contains(m.id))
 
      create(request.level, missions.take(count))
    }
  }
  
  def produceAll(levelId: String) = ActionWithValidLevel(levelId) { implicit request =>
    Async{
      val missions = Mission.findByDataSetName(request.level.dataSetName).toList
      create(request.level, missions) 
    }
  }

  def produceBulk(levelId: String) = ActionWithValidLevel(levelId, parse.urlFormEncoded) { implicit request =>
    Async{
      for {
        missionIds <- postParameterList("missionId") ?~ Messages("mission.startId.missing")
        missions = missionIds.flatMap(Mission.findOneById).toList
      } yield {
        create(request.level, missions)
      }
    }
  }
  
}