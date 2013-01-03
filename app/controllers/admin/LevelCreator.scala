package controllers.admin

import play.mvc.Security.Authenticated
import brainflight.security.Secured
import models.security.Role
import controllers.Controller
import views._
import models.knowledge.Level
import play.api.data.Form
import play.api.data.Forms.mapping
import play.api.data.Forms.number
import play.api.data.Forms.text
import play.api.i18n.Messages
import play.api.libs.json.Json
import play.api.libs.concurrent.Akka
import play.api.Play.current
import akka.actor.Props
import brainflight.knowledge.LevelCreateActor
import brainflight.knowledge.CreateLevel

object LevelCreator extends Controller with Secured {
  override def DefaultAccessRole = Role.Admin
  val levelCreateActor = Akka.system.actorOf(Props(new LevelCreateActor))

  val levelForm = Form(
    mapping(
      "name" -> text.verifying("level.invalidName", Level.isValidLevelName _),
      "width" -> number,
      "height" -> number,
      "depth" -> number)(Level.fromForm)(Level.toForm)).fill(Level.empty)

  def use(levelId: String, missionId: String) = Authenticated { implicit request =>
    for {
      level <- Level.findOneById(levelId) ?~ Messages("level.notFound")
    } yield {
      Ok(html.admin.creator.levelCreator(level, missionId))
    }
  }

  def delete(levelId: String) = Authenticated { implicit request =>
    for {
      level <- Level.findOneById(levelId) ?~ Messages("level.notFound")
    } yield {
      Level.remove(level)
      JsonOk(Messages("level.removed"))
    }
  }

  def submitCode(levelId: String) = Authenticated(parser = parse.urlFormEncoded) { implicit request =>
    for {
      code <- postParameter("code") ?~ Messages("level.code.notSupplied")
      level <- Level.findOneById(levelId) ?~ Messages("level.notFound")
    } yield {
      level.update(_.alterCode(code))
      JsonOk("level.code.saved")
    }
  }

  def uploadAsset(levelId: String) = Authenticated(parse.multipartFormData) { implicit request =>
    (for {
      assetFile <- request.body.file("asset") ?~ Messages("level.assets.notSupplied")
      level <- Level.findOneById(levelId) ?~ Messages("level.notFound")
      if (level.addAsset(assetFile.filename, assetFile.ref.file))
    } yield {
      JsonOk(Messages("level.assets.uploaded"))
    }) ?~ Messages("level.assets.uploadFailed")
  }

  def listAssets(levelId: String) = Authenticated { implicit request =>
    for {
      level <- Level.findOneById(levelId) ?~ Messages("level.notFound")
    } yield {
      Ok(Json.toJson(level.assets.map(_.getName)))
    }
  }

  def produce(levelId: String) = Authenticated { implicit request =>
    for {
      level <- Level.findOneById(levelId) ?~ Messages("level.notFound")
    } yield {
      levelCreateActor ! CreateLevel(level)
      Ok(Messages("level.creation.inProgress"))
    }
  }

  def retrieveAsset(levelId: String, asset: String) = Authenticated { implicit request =>
    for {
      level <- Level.findOneById(levelId) ?~ Messages("level.notFound")
      assetFile <- level.retrieveAsset(asset) ?~ Messages("level.assets.notFound")
    } yield {
      Ok.sendFile(assetFile, true)
    }
  }

  def deleteAsset(levelId: String, asset: String) = Authenticated { implicit request =>
    (for {
      level <- Level.findOneById(levelId) ?~ Messages("level.notFound")
      if (level.deleteAsset(asset))
    } yield {
      JsonOk(Messages("level.assets.deleted"))
    }) ?~ Messages("level.assets.deleteFailed")
  }

  def create = Authenticated(parser = parse.urlFormEncoded) { implicit request =>
    levelForm.bindFromRequest.fold(
      formWithErrors => BadRequest(html.admin.creator.levelList(Level.findAll, formWithErrors)), //((taskCreateHTML(taskFromTracingForm, formWithErrors)),
      { t =>
        if (Level.isValidLevelName(t.name)) {
          Level.insertOne(t)
          Ok(html.admin.creator.levelList(Level.findAll, levelForm))
        } else
          BadRequest(Messages("level.invalidName"))
      })
  }

  def list = Authenticated { implicit request =>
    Ok(html.admin.creator.levelList(Level.findAll, levelForm))
  }
}