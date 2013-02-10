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
import play.api.mvc.Action
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

  val levelForm = Form(
    mapping(
      "name" -> text.verifying("level.invalidName", Level.isValidLevelName _),
      "width" -> number,
      "height" -> number,
      "depth" -> number,
      "dataset" -> text.verifying("dataSet.notFound", DataSet.findOneByName(_).isDefined))(
        Level.fromForm)(Level.toForm)).fill(Level.empty)

  def use(levelId: String, missionStartId: Int) = Action { implicit request =>
    for {
      level <- Level.findOneById(levelId) ?~ Messages("level.notFound")
      mission <- Mission.findOneByStartId(level.dataSetName, missionStartId) orElse
        Mission.randomByDataSetName(level.dataSetName) ?~ Messages("mission.notFound")
    } yield {
      Ok(html.levelcreator.levelCreator(level, mission.start.startId))
    }
  }

  def stackList(levelId: String) = Action { implicit request =>
    for {
      level <- Level.findOneById(levelId) ?~ Messages("level.notFound")
    } yield {
      Ok(html.levelcreator.stackList(level))
    }
  }

  def delete(levelId: String) = Action { implicit request =>
    for {
      level <- Level.findOneById(levelId) ?~ Messages("level.notFound")
    } yield {
      Level.remove(level)
      JsonOk(Messages("level.removed"))
    }
  }

  def submitCode(levelId: String) = Action(parse.urlFormEncoded) { implicit request =>
    for {
      code <- postParameter("code") ?~ Messages("level.code.notSupplied")
      level <- Level.findOneById(levelId) ?~ Messages("level.notFound")
    } yield {
      level.update(_.alterCode(code))
      JsonOk("level.code.saved")
    }
  }

  def uploadAsset(levelId: String) = Action(parse.multipartFormData) { implicit request =>
    (for {
      assetFile <- request.body.file("asset") ?~ Messages("level.assets.notSupplied")
      level <- Level.findOneById(levelId) ?~ Messages("level.notFound")
      if (level.addAsset(assetFile.filename, assetFile.ref.file))
    } yield {
      JsonOk(Messages("level.assets.uploaded"))
    }) ?~ Messages("level.assets.uploadFailed")
  }

  def listAssets(levelId: String) = Action { implicit request =>
    for {
      level <- Level.findOneById(levelId) ?~ Messages("level.notFound")
    } yield {
      Ok(Json.toJson(level.assets.map(_.getName)))
    }
  }

  def createLevels(level: Level, missions: List[Mission]) = {
    val future = (levelCreateActor ? CreateLevels(level, missions)).recover {
      case e: AskTimeoutException =>
        //TODO when creating multiple stacks, actor may time out
        //he will go on creating though
        println("stack creation timed out")
        "timed out"
    }
    future.mapTo[String].map { result => Ok(result) }
  }

  def produce(levelId: String, count: Int) = Action { implicit request =>
    Async {
      for {
        level <- Level.findOneById(levelId) ?~ Messages("level.notFound")
        missions <- Mission.findNotProduced(level.dataSetName, level.renderedMissions, count) ?~ Messages("mission.notFound")
      } yield {
        createLevels(level, missions)
      }
    }
  }

  def produceBulk(levelId: String) = Action(parse.urlFormEncoded) { implicit request =>
    Async{
      for {
        level <- Level.findOneById(levelId) ?~ Messages("level.notFound")
        missionStartIds <- request.body.get("missionStartId") ?~ Messages("mission.startId.missing")
      } yield {
        val validIds = missionStartIds.flatMap(_.toIntOpt)
        val missions = Mission.findByStartId(level.dataSetName, validIds.toList)
        createLevels(level, missions)
      }
    }
  }

  def retrieveAsset(levelId: String, asset: String) = Action { implicit request =>
    for {
      level <- Level.findOneById(levelId) ?~ Messages("level.notFound")
      assetFile <- level.retrieveAsset(asset) ?~ Messages("level.assets.notFound")
    } yield {
      Ok.sendFile(assetFile, true)
    }
  }

  def deleteAsset(levelId: String, asset: String) = Action { implicit request =>
    (for {
      level <- Level.findOneById(levelId) ?~ Messages("level.notFound")
      if (level.deleteAsset(asset))
    } yield {
      JsonOk(Messages("level.assets.deleted"))
    }) ?~ Messages("level.assets.deleteFailed")
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