package controllers

import javax.inject.Inject
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.task._
import play.silhouette.api.Silhouette
import models.user.UserService
import play.api.libs.functional.syntax._
import play.api.libs.json.Reads._
import play.api.libs.json._
import play.api.mvc.{AbstractController, Action, AnyContent, ControllerComponents}
import security.WkEnv
import com.scalableminds.util.objectid.ObjectId

import scala.concurrent.ExecutionContext

class ScriptController @Inject() (
    scriptDAO: ScriptDAO,
    taskDAO: TaskDAO,
    scriptService: ScriptService,
    userService: UserService,
    sil: Silhouette[WkEnv],
    cc: ControllerComponents
)(implicit ec: ExecutionContext)
    extends AbstractController(cc)
    with WkControllerUtils
    with FoxImplicits {

  private val scriptPublicReads =
    ((__ \ "name").read[String](minLength[String](2) or maxLength[String](50)) and
      (__ \ "gist").read[String] and
      (__ \ "owner").read[ObjectId])(Script.fromForm)

  def create: Action[JsValue] = sil.SecuredAction.async(parse.json) { implicit request =>
    withJsonBodyUsing(scriptPublicReads) { script =>
      for {
        isTeamManagerOrAdmin <- userService.isTeamManagerOrAdminOfOrg(request.identity, request.identity._organization)
        _ <- bool2Fox(isTeamManagerOrAdmin) ?~> "notAllowed" ~> FORBIDDEN
        _ <- bool2Fox(script._owner == request.identity._id) ?~> "notAllowed" ~> FORBIDDEN
        _ <- scriptService.assertValidScriptName(script.name)
        _ <- scriptDAO.insertOne(script)
        js <- scriptService.publicWrites(script) ?~> "script.write.failed"
      } yield Ok(js)
    }
  }

  def get(scriptId: ObjectId): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      script <- scriptDAO.findOne(scriptId) ?~> "script.notFound" ~> NOT_FOUND
      js <- scriptService.publicWrites(script) ?~> "script.write.failed"
    } yield Ok(js)
  }

  def list: Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      scripts <- scriptDAO.findAll
      js <- Fox.serialCombined(scripts)(s => scriptService.publicWrites(s))
    } yield Ok(Json.toJson(js))
  }

  def update(scriptId: ObjectId): Action[JsValue] = sil.SecuredAction.async(parse.json) { implicit request =>
    withJsonBodyUsing(scriptPublicReads) { scriptFromForm =>
      for {
        oldScript <- scriptDAO.findOne(scriptId) ?~> "script.notFound" ~> NOT_FOUND
        _ <- bool2Fox(oldScript._owner == request.identity._id) ?~> "script.notOwner" ~> FORBIDDEN
        _ <- scriptService.assertValidScriptName(scriptFromForm.name)
        updatedScript = scriptFromForm.copy(_id = oldScript._id)
        _ <- scriptDAO.updateOne(updatedScript)
        js <- scriptService.publicWrites(updatedScript) ?~> "script.write.failed"
      } yield Ok(js)
    }
  }

  def delete(scriptId: ObjectId): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      oldScript <- scriptDAO.findOne(scriptId) ?~> "script.notFound" ~> NOT_FOUND
      _ <- bool2Fox(oldScript._owner == request.identity._id) ?~> "script.notOwner" ~> FORBIDDEN
      _ <- scriptDAO.deleteOne(scriptId) ?~> "script.removalFailed"
      _ <- taskDAO.removeScriptFromAllTasks(scriptId) ?~> "script.removalFailed"
    } yield Ok
  }
}
