package controllers.levelcreator

import braingames.mvc.Controller
import play.api.libs.concurrent._
import views._
import braingames.mvc._
import models.knowledge._
import play.api.Play.current
import akka.actor._
import braingames.levelcreator._
import play.api.data._
import play.api.data.Forms._
import play.api.mvc.Action
import play.api.i18n.Messages
import play.api.libs.json._

object LevelCreator extends Controller {

  val levelCreateActor = Akka.system.actorOf(Props(new LevelCreateActor))

  val levelForm = Form(
    mapping(
      "name" -> text.verifying("level.invalidName", Level.isValidLevelName _),
      "width" -> number,
      "height" -> number,
      "depth" -> number)(Level.fromForm)(Level.toForm)).fill(Level.empty)

  def use(levelId: String, missionId: String) = Action { implicit request =>
    for {
      level <- Level.findOneById(levelId) ?~ Messages("level.notFound")
    } yield {
      Ok(html.levelcreator.levelCreator(level, missionId))
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

  def produce(levelId: String) = Action { implicit request =>
    for {
      level <- Level.findOneById(levelId) ?~ Messages("level.notFound")
    } yield {
      levelCreateActor ! CreateLevel(level)
      Ok(Messages("level.creation.inProgress"))
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
      formWithErrors => BadRequest(html.levelcreator.levelList(Level.findAll, formWithErrors)), //((taskCreateHTML(taskFromTracingForm, formWithErrors)),
      { t =>
        if (Level.isValidLevelName(t.name)) {
          Level.insertOne(t)
          Ok(html.levelcreator.levelList(Level.findAll, levelForm))
        } else
          BadRequest(Messages("level.invalidName"))
      })
  }

  def list = Action { implicit request =>
    Ok(html.levelcreator.levelList(Level.findAll, levelForm))
  }
}