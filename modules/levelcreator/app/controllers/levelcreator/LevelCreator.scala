package controllers.levelcreator

import braingames.mvc.Controller
import play.api.libs.concurrent._
import scala.concurrent.duration._
import scala.concurrent._
import akka.pattern.ask
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

  val levelCreateActor = Akka.system.actorOf(Props(new LevelCreateActor))

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

  def use(levelId: String, missionStartId: Int) = ActionWithValidLevel(levelId){ implicit request =>
    val missionOpt = Mission.findOneByStartId(request.level.dataSetName, missionStartId) orElse
        Mission.randomByDataSetName(request.level.dataSetName)
    for {
      mission <- missionOpt ?~ Messages("mission.notFound")
    } yield {
      Ok(html.levelcreator.levelCreator(request.level, mission.start.startId))
    } 
  }

  def stackList(levelId: String) = ActionWithValidLevel(levelId) { implicit request =>
      Ok(html.levelcreator.stackList(request.level))
  }
  
  def deleteStack(levelId: String, missionStartId: Int) = ActionWithValidLevel(levelId) { implicit request =>
      request.level.removeRenderedMission(missionStartId)
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

  def createLevels(level: Level, missions: List[Mission]) = {
    val future = (levelCreateActor ? CreateLevels(level, missions)).recover {
      case e: AskTimeoutException =>
        //TODO when creating multiple stacks, actor may time out
        //he will go on creating though
        println("stack creation timed out")
        Messages("level.stack.creationTimeout")
    }
    future.mapTo[String].map { result => JsonOk(result) }
  }

  def produce(levelId: String, count: Int) = ActionWithValidLevel(levelId) { implicit request =>
    Async {
      for {
        missions <- Mission.findNotProduced(request.level.dataSetName, request.level.renderedMissions, count) ?~ Messages("mission.notFound")
      } yield {
        createLevels(request.level, missions)
      }
    }
  }

  def produceBulk(levelId: String) = ActionWithValidLevel(levelId, parse.urlFormEncoded) { implicit request =>
    Async{
      for {
        missionStartIds <- postParameterList("missionStartId") ?~ Messages("mission.startId.missing")
        missions = Mission.findByStartId(request.level.dataSetName, missionStartIds.toList.flatMap(_.toIntOpt))
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