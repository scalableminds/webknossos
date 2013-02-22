package controllers.levelcreator

import braingames.mvc.Controller
import views._
import braingames.mvc._
import models.knowledge._
import play.api.Play.current
import play.api.mvc.Action
import play.api.data._
import play.api.data.Forms._
import play.api.i18n.Messages
import play.api.libs.json._
import play.api._

import java.io.File
import scala.util.Failure
import models.binary.DataSet
import braingames.util.ExtendedTypes.ExtendedString

object LevelCreator extends LevelCreatorController {

  val levelForm = Form(
    mapping(
      "name" -> text.verifying("level.invalidName", Level.isValidLevelName _),
      "width" -> number,
      "height" -> number,
      "slides before problem" -> number,
      "slides after problem" -> number,
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