package controllers

import com.scalableminds.util.Msg

import javax.inject.Inject
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.task._
import play.silhouette.api.Silhouette
import models.user.UserService
import play.api.libs.functional.syntax._
import play.api.libs.json.Reads._
import play.api.libs.json._
import play.api.mvc.{Action, AnyContent}
import security.WkEnv
import com.scalableminds.util.objectid.ObjectId

import scala.concurrent.ExecutionContext

class ScriptController @Inject()(scriptDAO: ScriptDAO,
                                 taskDAO: TaskDAO,
                                 scriptService: ScriptService,
                                 userService: UserService,
                                 sil: Silhouette[WkEnv])(implicit ec: ExecutionContext)
    extends Controller
    with FoxImplicits {

  private val scriptPublicReads =
    ((__ \ "name").read[String](using minLength[String](2) or maxLength[String](50)) and
      (__ \ "gist").read[String] and
      (__ \ "owner").read[ObjectId])(Script.fromForm)

  def create: Action[JsValue] = sil.SecuredAction.async(parse.json) { implicit request =>
    withJsonBodyUsing(scriptPublicReads) { script =>
      for {
        isTeamManagerOrAdmin <- userService.isTeamManagerOrAdminOfOrg(request.identity, request.identity._organization)
        _ <- Fox.fromBool(isTeamManagerOrAdmin) ?~> Msg.notAllowed ~> FORBIDDEN
        _ <- Fox.fromBool(script._owner == request.identity._id) ?~> Msg.notAllowed ~> FORBIDDEN
        _ <- scriptService.assertValidScriptName(script.name)
        _ <- scriptDAO.insertOne(script)
        js <- scriptService.publicWrites(script) ?~> Msg.Script.publicWritesFailed
      } yield Ok(js)
    }
  }

  def get(scriptId: ObjectId): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      script <- scriptDAO.findOne(scriptId) ?~> Msg.Script.notFound(scriptId) ~> NOT_FOUND
      js <- scriptService.publicWrites(script) ?~> Msg.Script.publicWritesFailed
    } yield {
      Ok(js)
    }
  }

  def list: Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      scripts <- scriptDAO.findAll
      js <- Fox.serialCombined(scripts)(s => scriptService.publicWrites(s))
    } yield {
      Ok(Json.toJson(js))
    }
  }

  def update(scriptId: ObjectId): Action[JsValue] = sil.SecuredAction.async(parse.json) { implicit request =>
    withJsonBodyUsing(scriptPublicReads) { scriptFromForm =>
      for {
        oldScript <- scriptDAO.findOne(scriptId) ?~> Msg.Script.notFound(scriptId) ~> NOT_FOUND
        _ <- Fox.fromBool(oldScript._owner == request.identity._id) ?~> Msg.Script.updateOnlyOwner ~> FORBIDDEN
        _ <- scriptService.assertValidScriptName(scriptFromForm.name)
        updatedScript = scriptFromForm.copy(_id = oldScript._id)
        _ <- scriptDAO.updateOne(updatedScript)
        js <- scriptService.publicWrites(updatedScript) ?~> Msg.Script.publicWritesFailed
      } yield {
        Ok(js)
      }
    }
  }

  def delete(scriptId: ObjectId): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      oldScript <- scriptDAO.findOne(scriptId) ?~> Msg.Script.notFound(scriptId) ~> NOT_FOUND
      _ <- Fox.fromBool(oldScript._owner == request.identity._id) ?~> Msg.Script.deleteOnlyOwner ~> FORBIDDEN
      _ <- scriptDAO.deleteOne(scriptId) ?~> Msg.Script.deleteFailed
      _ <- taskDAO.removeScriptFromAllTasks(scriptId) ?~> Msg.Script.deleteFailed
    } yield {
      Ok
    }
  }
}
