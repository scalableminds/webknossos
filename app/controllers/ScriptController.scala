package controllers

import javax.inject.Inject
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.task._
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.functional.syntax._
import play.api.libs.json.Reads._
import play.api.libs.json._
import oxalis.security.WebknossosSilhouette.SecuredAction
import utils.ObjectId


class ScriptController @Inject()(val messagesApi: MessagesApi) extends Controller with FoxImplicits {

  val scriptPublicReads =
    ((__ \ 'name).read[String](minLength[String](2) or maxLength[String](50)) and
      (__ \ 'gist).read[String] and
      (__ \ 'owner).read[String] (ObjectId.stringObjectIdReads("owner"))) (ScriptSQL.fromForm _)

  def create = SecuredAction.async(parse.json) { implicit request =>
    withJsonBodyUsing(scriptPublicReads) { script =>
      for {
        _ <- request.identity.isAdmin ?~> Messages("notAllowed")
        _ <- ScriptSQLDAO.insertOne(script)
        js <- script.publicWrites
      } yield {
        Ok(js)
      }
    }
  }

  def get(scriptId: String) = SecuredAction.async { implicit request =>
    for {
      scriptIdValidated <- ObjectId.parse(scriptId)
      script <- ScriptSQLDAO.findOne(scriptIdValidated) ?~> Messages("script.notFound")
      js <- script.publicWrites
    } yield {
      Ok(js)
    }
  }

  def list = SecuredAction.async { implicit request =>
    for {
      scripts <- ScriptSQLDAO.findAll
      js <- Fox.serialCombined(scripts)(s => s.publicWrites)
    } yield {
      Ok(Json.toJson(js))
    }
  }

  def update(scriptId: String) = SecuredAction.async(parse.json) { implicit request =>
    withJsonBodyUsing(scriptPublicReads) { scriptFromForm =>
      for {
        scriptIdValidated <- ObjectId.parse(scriptId)
        oldScript <- ScriptSQLDAO.findOne(scriptIdValidated) ?~> Messages("script.notFound")
        _ <- (oldScript._owner == ObjectId.fromBsonId(request.identity._id)) ?~> Messages("script.notOwner")
        updatedScript = scriptFromForm.copy(_id = oldScript._id)
        _ <- ScriptSQLDAO.updateOne(updatedScript)
        js <- updatedScript.publicWrites
      } yield {
        Ok(js)
      }
    }
  }

  def delete(scriptId: String) = SecuredAction.async { implicit request =>
    for {
      scriptIdValidated <- ObjectId.parse(scriptId)
      oldScript <- ScriptSQLDAO.findOne(scriptIdValidated) ?~> Messages("script.notFound")
      _ <- (oldScript._owner == ObjectId.fromBsonId(request.identity._id)) ?~> Messages("script.notOwner")
      _ <- ScriptSQLDAO.deleteOne(scriptIdValidated) ?~> Messages("script.removalFailed")
      _ <- TaskSQLDAO.removeScriptFromAllTasks(scriptIdValidated) ?~> Messages("script.removalFailed")
    } yield {
      Ok
    }
  }
}
