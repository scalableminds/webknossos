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

  def use(levelId: String) = Authenticated { implicit request =>
    Level
      .findOneById(levelId)
      .map { level =>
        Ok(html.admin.creator.levelCreator(level))
      }
      .getOrElse(BadRequest("Level not found."))
  }

  def delete(levelId: String) = Authenticated { implicit request =>
    Level
      .findOneById(levelId)
      .map { level =>
        Level.remove(level)
        AjaxOk.success(Messages("level.removed"))
      }
      .getOrElse(AjaxBadRequest.error("Level not found."))
  }

  def submitCode(levelId: String) = Authenticated(parser = parse.urlFormEncoded) { implicit request =>
    (for {
      code <- request.body.get("code").flatMap(_.headOption)
      level <- Level.findOneById(levelId)
    } yield {
      level.update(_.alterCode(code))
      AjaxOk.success("level.codeSaved")
    }) getOrElse AjaxBadRequest.error("Missing parameters.")
  }

  def uploadAsset(levelId: String) = Authenticated(parse.multipartFormData) { implicit request =>
    request.body.file("asset").flatMap { assetFile =>
      Level.findOneById(levelId).map { level =>
        if (level.addAsset(assetFile.filename, assetFile.ref.file))
          AjaxOk.success(Messages("level.assets.uploadSuccess"))
        else
          AjaxBadRequest.error("Could not upload.")
      }
    } getOrElse AjaxBadRequest.error("Invalid request or level.")
  }

  def listAssets(levelId: String) = Authenticated { implicit request =>
    Level
      .findOneById(levelId)
      .map { level =>
        Ok(Json.toJson(level.assets.map(_.getName)))
      }
      .getOrElse(BadRequest("Level not found."))
  }

  def produce(levelId: String) = Authenticated { implicit request =>
    Level
      .findOneById(levelId)
      .map { level =>
        levelCreateActor ! CreateLevel(level)
        Ok("On my way")
      }
      .getOrElse(BadRequest("Level not found."))
  }

  def retrieveAsset(levelId: String, asset: String) = Authenticated { implicit request =>
    Level
      .findOneById(levelId)
      .map { level =>
        level.retrieveAsset(asset) match {
          case Some(assetFile) =>
            Ok.sendFile(assetFile, true)
          case _ =>
            BadRequest("Asset not found.")
        }
      }
      .getOrElse(BadRequest("Level not found."))
  }

  def deleteAsset(levelId: String, asset: String) = Authenticated { implicit request =>
    Level
      .findOneById(levelId)
      .map { level =>
        level.deleteAsset(asset) match {
          case true =>
            AjaxOk.success(Messages("level.assets.deleted"))
          case _ =>
            AjaxBadRequest.error("Asset not found.")
        }
      }
      .getOrElse(AjaxBadRequest.error("Level not found."))
  }

  def create = Authenticated(parser = parse.urlFormEncoded) { implicit request =>
    levelForm.bindFromRequest.fold(
      formWithErrors => BadRequest(html.admin.creator.levelList(Level.findAll, formWithErrors)), //((taskCreateHTML(taskFromTracingForm, formWithErrors)),
      { t =>
        if (Level.isValidLevelName(t.name)) {
          Level.insertOne(t)
          Ok(html.admin.creator.levelList(Level.findAll, levelForm))
        } else
          BadRequest("Invalid level name")
      })
  }

  def list = Authenticated { implicit request =>
    Ok(html.admin.creator.levelList(Level.findAll, levelForm))
  }
}