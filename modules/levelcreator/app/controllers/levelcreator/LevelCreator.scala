package controllers.levelcreator

import braingames.mvc.Controller
import play.api.libs.concurrent._
import scala.concurrent.duration._
import scala.concurrent._
import akka.pattern.ask
import akka.routing.RoundRobinRouter
import views._
import braingames.mvc._
import models.knowledge._
import play.api.Play.current
import akka.actor._
import akka.util.Timeout
import akka.pattern.AskTimeoutException
import braingames.levelcreator._
import play.api.data._
import play.api.data.Forms._
import play.api.mvc.{Action, Request, WrappedRequest, BodyParser, Result, BodyParsers}
import play.api.i18n.Messages
import play.api.libs.json._
import play.api._
import ExecutionContext.Implicits.global
import java.io.File
import scala.util.Failure
import models.binary.DataSet
import braingames.util.ExtendedTypes.ExtendedString

object LevelCreator extends Controller {

  val levelCreateRouter = Akka.system.actorOf(Props[LevelCreateActor].withRouter(RoundRobinRouter(nrOfInstances = 4)),
      name = "LevelCreateRouter")

  val conf = Play.current.configuration
  implicit val timeout = Timeout(60 seconds)

  case class LevelRequest[T](val level: Level, val request: Request[T]) extends WrappedRequest(request)
  
  def ActionWithValidLevel[T](levelId: String, parser: BodyParser[T] = BodyParsers.parse.anyContent)
  (f: LevelRequest[T] => Result) = Action(parser){ 
    implicit request => 
    for {
      level <- Level.findOneById(levelId) ?~ Messages("level.notFound")
    } yield {
      f(LevelRequest(level, request))
    }
  }
  
  val levelForm = Form(
    mapping(
      "name" -> text.verifying("level.invalidName", Level.isValidLevelName _),
      "width" -> number,
      "height" -> number,
      "depth" -> number,
      "dataset" -> text.verifying("dataSet.notFound", DataSet.findOneByName(_).isDefined))(
        Level.fromForm)(Level.toForm)).fill(Level.empty)

  def use(levelId: String, missionId: String) = ActionWithValidLevel(levelId){ implicit request =>
    val missionOpt = Mission.findOneById(missionId) orElse
        Mission.randomByDataSetName(request.level.dataSetName)
    for {
      mission <- missionOpt ?~ Messages("mission.notFound")
    } yield {
      Ok(html.levelcreator.levelCreator(request.level, mission.id))
    } 
  }

  def stackList(levelId: String) = ActionWithValidLevel(levelId) { implicit request =>
      Ok(html.levelcreator.stackList(request.level))
  }
  
  def deleteStack(levelId: String, missionId: String) = ActionWithValidLevel(levelId) { implicit request =>
      request.level.removeRenderedMission(missionId)
      JsonOk(Messages("level.stack.removed"))
  }

  def delete(levelId: String) = ActionWithValidLevel(levelId) { implicit request =>
      Level.remove(request.level)
      JsonOk(Messages("level.removed"))
  }

  def submitCode(levelId: String) = ActionWithValidLevel(levelId, parse.urlFormEncoded) { implicit request =>
    for {
      code <- postParameter("code") ?~ Messages("level.code.notSupplied")
    } yield {
      request.level.update(_.alterCode(code))
      JsonOk("level.code.saved")
    }
  }

  def uploadAsset(levelId: String) = ActionWithValidLevel(levelId, parse.multipartFormData) { implicit request =>
    (for {
      assetFile <- request.body.file("asset") ?~ Messages("level.assets.notSupplied")
      if (request.level.addAsset(assetFile.filename, assetFile.ref.file))
    } yield {
      JsonOk(Messages("level.assets.uploaded"))
    }) ?~ Messages("level.assets.uploadFailed")
  }

  def listAssets(levelId: String) = ActionWithValidLevel(levelId) { implicit request =>
      Ok(Json.toJson(request.level.assets.map(_.getName)))
  }
  //TODO: make this parallel in a way that a single actor gets one mission to create at a time and then add created missions 
  // depending on which were successfully created
  def createLevels(level: Level, missions: List[Mission]) = {
    implicit val timeout = Timeout((60 * missions.size) seconds)
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
 
      createLevels(request.level, missions.take(count))
    }
  }
  
  def produceAll(levelId: String) = ActionWithValidLevel(levelId) { implicit request =>
    Async{
      val missions = Mission.findByDataSetName(request.level.dataSetName).toList
      createLevels(request.level, missions) 
    }
  }

  def produceBulk(levelId: String) = ActionWithValidLevel(levelId, parse.urlFormEncoded) { implicit request =>
    Async{
      for {
        missionIds <- postParameterList("missionId") ?~ Messages("mission.startId.missing")
        missions = missionIds.flatMap(Mission.findOneById).toList
      } yield {
        createLevels(request.level, missions)
      }
    }
  }

  def retrieveAsset(levelId: String, asset: String) = ActionWithValidLevel(levelId) { implicit request =>
    for {
      assetFile <- request.level.retrieveAsset(asset) ?~ Messages("level.assets.notFound")
    } yield {
      Ok.sendFile(assetFile, true)
    }
  }

  def deleteAsset(levelId: String, asset: String) = ActionWithValidLevel(levelId) { implicit request =>
      if (request.level.deleteAsset(asset))
        JsonOk(Messages("level.assets.deleted"))
      else
        JsonBadRequest(Messages("level.assets.deleteFailed"))
  }

  def create = Action(parse.urlFormEncoded) { implicit request =>
    levelForm.bindFromRequest.fold(
      formWithErrors => BadRequest(html.levelcreator.levelList(Level.findAll, formWithErrors, DataSet.findAll)), //((taskCreateHTML(taskFromTracingForm, formWithErrors)),
      { t =>
        if (Level.isValidLevelName(t.name)) {
          Level.insertOne(t)
          Ok(html.levelcreator.levelList(Level.findAll, levelForm, DataSet.findAll))
        } else
          BadRequest(Messages("level.invalidName"))
      })
  }

  def list = Action { implicit request =>
    Ok(html.levelcreator.levelList(Level.findAll, levelForm, DataSet.findAll))
  }
}