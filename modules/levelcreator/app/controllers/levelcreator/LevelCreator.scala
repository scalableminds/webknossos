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
import braingames.binary.models.DataSet
import braingames.util.ExtendedTypes.ExtendedString
import play.api.libs.concurrent.Execution.Implicits._
import scala.concurrent.Future
import play.api.templates.Html

object LevelCreator extends LevelCreatorController {

  val levelForm = Form(
    mapping(
      "name" -> text
        .verifying("level.invalidName", Level.isValidLevelName _)
        .verifying("level.alreadyInUse", name => Level.findByName(name).isEmpty ),
      "width" -> number,
      "height" -> number,
      "slides before problem" -> number,
      "slides after problem" -> number,
      "dataset" -> text.verifying("dataSet.notFound", DataSet.findOneByName(_).isDefined))(
        Level.fromForm)(Level.toForm)).fill(Level.empty)

  def use(levelId: String, missionId: String) = ActionWithValidLevel(levelId) { implicit request =>
    val missionOpt = Mission.findOneById(missionId) orElse
      Mission.randomByDataSetName(request.level.dataSetName)
    for {
      mission <- missionOpt ?~ Messages("mission.notFound")
    } yield {
      Ok(html.levelcreator.levelCreator(request.level, mission))
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
      val n = Level.createNewVersion(request.level, code)
      JsonOk(
          Json.obj(
              "newId" -> n.id,
              "newName" -> n.levelId.toBeautifiedString), "level.code.saved")
    }
  }

  def uploadAsset(levelId: String) = ActionWithValidLevel(levelId, parse.multipartFormData) { implicit request =>
    for {
      assetFile <- request.body.file("asset") ?~ Messages("level.assets.notSupplied")
    } yield {
      request.level.update(_.addAsset(assetFile.filename, assetFile.ref.file))
      JsonOk(Messages("level.assets.uploaded"))
    }
  }

  def listAssets(levelId: String) = ActionWithValidLevel(levelId) { implicit request =>
    Ok(Json.toJson(request.level.assets.map(_.accessName)))
  }

  def retrieveAsset(levelId: String, asset: String) = ActionWithValidLevel(levelId) { implicit request =>
    for {
      assetFile <- request.level.retrieveAsset(asset) ?~ Messages("level.assets.notFound")
    } yield {
      Ok.sendFile(assetFile, true)
    }
  }

  def deleteAsset(levelId: String, asset: String) = ActionWithValidLevel(levelId) { implicit request =>
    request.level.update(_.deleteAsset(asset))
    JsonOk(Messages("level.assets.deleted"))
  }

  def create = Action(parse.urlFormEncoded) { implicit request =>
    Async {
      levelForm.bindFromRequest.fold(
        formWithErrors =>
          generateLevelList(formWithErrors).map(BadRequest.apply[Html]), //((taskCreateHTML(taskFromTracingForm, formWithErrors)),
        { t =>
            Level.insertOne(t)
            generateLevelList(levelForm).map(Ok.apply[Html])
        })
    }
  }
  
  def progress(levelId: String) = ActionWithValidLevel(levelId) { implicit request =>
    val queued = StacksQueued.findFor(request.level.levelId).size
    val inProgress = StacksInProgress.findFor(request.level.levelId).size
    Ok(html.levelcreator.levelGenerationProgress(request.level, queued, inProgress))
  }
  
  def setAsActiveVersion(levelId: String) = ActionWithValidLevel(levelId) { implicit request =>
    Level.setAsActiveVersion(request.level)
    JsonOk(Messages("level.render.setAsActiveVersion"))
  }

  def autoRender(levelId: String, isEnabled: Boolean) = ActionWithValidLevel(levelId) { implicit request =>
    request.level.update(_.copy(autoRender = isEnabled))
    if (isEnabled) 
      JsonOk(Messages("level.render.autoRenderEnabled"))
    else
      JsonOk(Messages("level.render.autoRenderDisabled"))
  }

  def generateLevelList(levelForm: Form[Level])(implicit session: brainflight.view.UnAuthedSessionData): Future[Html] = {
    WorkController.countActiveRenderers.map { rendererCount =>
      val stacksInQueue =
        StacksQueued.findAll.groupBy(_.level.levelId).mapValues(_.size)

      val stacksInGeneration =
        StacksInProgress.findAll.groupBy(_._level).mapValues(_.size)

      html.levelcreator.levelList(Level.findAllLatest, levelForm, DataSet.findAll, stacksInQueue, stacksInGeneration, rendererCount)
    }
  }

  def list = Action { implicit request =>
    Async {
      generateLevelList(levelForm).map(Ok.apply[Html])
    }
  }
}