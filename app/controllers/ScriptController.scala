package controllers

import com.scalableminds.util.accesscontext.DBAccessContext
import javax.inject.Inject
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.task._
import oxalis.security.WkEnv
import com.mohiva.play.silhouette.api.Silhouette
import com.mohiva.play.silhouette.api.actions.{SecuredRequest, UserAwareRequest}
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.functional.syntax._
import play.api.libs.json.Reads._
import play.api.libs.json._
import utils.ObjectId


class ScriptController @Inject()(scriptDAO: ScriptDAO,
                                 taskDAO: TaskDAO,
                                 scriptService: ScriptService,
                                 sil: Silhouette[WkEnv],
                                 val messagesApi: MessagesApi) extends Controller with FoxImplicits {

  val scriptPublicReads =
    ((__ \ 'name).read[String](minLength[String](2) or maxLength[String](50)) and
      (__ \ 'gist).read[String] and
      (__ \ 'owner).read[String] (ObjectId.stringObjectIdReads("owner"))) (Script.fromForm _)

  def create = sil.SecuredAction.async(parse.json) { implicit request =>
    withJsonBodyUsing(scriptPublicReads) { script =>
      for {
        _ <- bool2Fox(request.identity.isAdmin) ?~> "notAllowed"
        _ <- scriptDAO.insertOne(script)
        js <- scriptService.publicWrites(script) ?~> "script.write.failed"
      } yield {
        Ok(js)
      }
    }
  }

  def get(scriptId: String) = sil.SecuredAction.async { implicit request =>
    for {
      scriptIdValidated <- ObjectId.parse(scriptId)
      script <- scriptDAO.findOne(scriptIdValidated) ?~> "script.notFound"
      js <- scriptService.publicWrites(script) ?~> "script.write.failed"
    } yield {
      Ok(js)
    }
  }

  def list = sil.SecuredAction.async { implicit request =>
    for {
      scripts <- scriptDAO.findAll
      js <- Fox.serialCombined(scripts)(s => scriptService.publicWrites(s))
    } yield {
      Ok(Json.toJson(js))
    }
  }

  def update(scriptId: String) = sil.SecuredAction.async(parse.json) { implicit request =>
    withJsonBodyUsing(scriptPublicReads) { scriptFromForm =>
      for {
        scriptIdValidated <- ObjectId.parse(scriptId)
        oldScript <- scriptDAO.findOne(scriptIdValidated) ?~> "script.notFound"
        _ <- bool2Fox(oldScript._owner == request.identity._id) ?~> "script.notOwner"
        updatedScript = scriptFromForm.copy(_id = oldScript._id)
        _ <- scriptDAO.updateOne(updatedScript)
        js <- scriptService.publicWrites(updatedScript) ?~> "script.write.failed"
      } yield {
        Ok(js)
      }
    }
  }

  def delete(scriptId: String) = sil.SecuredAction.async { implicit request =>
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
