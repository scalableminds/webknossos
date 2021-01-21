package controllers

import javax.inject.Inject
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.task._
import oxalis.security.WkEnv
import com.mohiva.play.silhouette.api.Silhouette
import models.user.UserService
import play.api.libs.functional.syntax._
import play.api.libs.json.Reads._
import play.api.libs.json._
import play.api.mvc.{Action, AnyContent}
import utils.ObjectId

import scala.concurrent.ExecutionContext

class ScriptController @Inject()(scriptDAO: ScriptDAO,
                                 taskDAO: TaskDAO,
                                 scriptService: ScriptService,
                                 userService: UserService,
                                 sil: Silhouette[WkEnv])(implicit ec: ExecutionContext)
    extends Controller
    with FoxImplicits {

  private val scriptPublicReads =
    ((__ \ 'name).read[String](minLength[String](2) or maxLength[String](50)) and
      (__ \ 'gist).read[String] and
      (__ \ 'owner).read[String](ObjectId.stringObjectIdReads("owner")))(Script.fromForm _)

  def create: Action[JsValue] = sil.SecuredAction.async(parse.json) { implicit request =>
    withJsonBodyUsing(scriptPublicReads) { script =>
      for {
        isTeamManagerOrAdmin <- userService.isTeamManagerOrAdminOfOrg(request.identity, request.identity._organization)
        _ <- bool2Fox(isTeamManagerOrAdmin) ?~> "notAllowed" ~> FORBIDDEN
        _ <- bool2Fox(script._owner == request.identity._id) ?~> "notAllowed" ~> FORBIDDEN
        _ <- scriptDAO.insertOne(script)
        js <- scriptService.publicWrites(script) ?~> "script.write.failed"
      } yield Ok(js)
    }
  }

  def get(scriptId: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      scriptIdValidated <- ObjectId.parse(scriptId)
      script <- scriptDAO.findOne(scriptIdValidated) ?~> "script.notFound" ~> NOT_FOUND
      js <- scriptService.publicWrites(script) ?~> "script.write.failed"
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

  def update(scriptId: String): Action[JsValue] = sil.SecuredAction.async(parse.json) { implicit request =>
    withJsonBodyUsing(scriptPublicReads) { scriptFromForm =>
      for {
        scriptIdValidated <- ObjectId.parse(scriptId)
        oldScript <- scriptDAO.findOne(scriptIdValidated) ?~> "script.notFound" ~> NOT_FOUND
        _ <- bool2Fox(oldScript._owner == request.identity._id) ?~> "script.notOwner" ~> FORBIDDEN
        updatedScript = scriptFromForm.copy(_id = oldScript._id)
        _ <- scriptDAO.updateOne(updatedScript)
        js <- scriptService.publicWrites(updatedScript) ?~> "script.write.failed"
      } yield {
        Ok(js)
      }
    }
  }

  def delete(scriptId: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      scriptIdValidated <- ObjectId.parse(scriptId)
      oldScript <- scriptDAO.findOne(scriptIdValidated) ?~> "script.notFound" ~> NOT_FOUND
      _ <- bool2Fox(oldScript._owner == request.identity._id) ?~> "script.notOwner" ~> FORBIDDEN
      _ <- scriptDAO.deleteOne(scriptIdValidated) ?~> "script.removalFailed"
      _ <- taskDAO.removeScriptFromAllTasks(scriptIdValidated) ?~> "script.removalFailed"
    } yield {
      Ok
    }
  }
}
