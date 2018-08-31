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


class ScriptController @Inject()(scriptDAO: ScriptDAO,
                                 taskDAO: TaskDAO,
                                 val messagesApi: MessagesApi) extends Controller with FoxImplicits {

  val scriptPublicReads =
    ((__ \ 'name).read[String](minLength[String](2) or maxLength[String](50)) and
      (__ \ 'gist).read[String] and
      (__ \ 'owner).read[String] (ObjectId.stringObjectIdReads("owner"))) (Script.fromForm _)

  def create = SecuredAction.async(parse.json) { implicit request =>
    withJsonBodyUsing(scriptPublicReads) { script =>
      for {
        _ <- bool2Fox(request.identity.isAdmin) ?~> "notAllowed"
        _ <- scriptDAO.insertOne(script)
        js <- script.publicWrites ?~> "script.write.failed"
      } yield {
        Ok(js)
      }
    }
  }

  def get(scriptId: String) = SecuredAction.async { implicit request =>
    for {
      scriptIdValidated <- ObjectId.parse(scriptId)
      script <- scriptDAO.findOne(scriptIdValidated) ?~> "script.notFound"
      js <- script.publicWrites ?~> "script.write.failed"
    } yield {
      Ok(js)
    }
  }

  def list = SecuredAction.async { implicit request =>
    for {
      scripts <- scriptDAO.findAll
      js <- Fox.serialCombined(scripts)(s => s.publicWrites)
    } yield {
      Ok(Json.toJson(js))
    }
  }

  def update(scriptId: String) = SecuredAction.async(parse.json) { implicit request =>
    withJsonBodyUsing(scriptPublicReads) { scriptFromForm =>
      for {
        scriptIdValidated <- ObjectId.parse(scriptId)
        oldScript <- scriptDAO.findOne(scriptIdValidated) ?~> "script.notFound"
        _ <- bool2Fox(oldScript._owner == request.identity._id) ?~> "script.notOwner"
        updatedScript = scriptFromForm.copy(_id = oldScript._id)
        _ <- scriptDAO.updateOne(updatedScript)
        js <- updatedScript.publicWrites ?~> "script.write.failed"
      } yield {
        Ok(js)
      }
    }
  }

  def delete(scriptId: String) = SecuredAction.async { implicit request =>
    for {
      scriptIdValidated <- ObjectId.parse(scriptId)
      oldScript <- scriptDAO.findOne(scriptIdValidated) ?~> "script.notFound"
      _ <- bool2Fox(oldScript._owner == request.identity._id) ?~> "script.notOwner"
      _ <- scriptDAO.deleteOne(scriptIdValidated) ?~> "script.removalFailed"
      _ <- taskDAO.removeScriptFromAllTasks(scriptIdValidated) ?~> "script.removalFailed"
    } yield {
      Ok
    }
  }
}
