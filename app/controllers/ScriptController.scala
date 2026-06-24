package controllers

import com.scalableminds.util.Msg

import javax.inject.Inject
import com.scalableminds.util.tools.Fox
import models.task._
import play.silhouette.api.Silhouette
import models.user.UserService
import play.api.libs.json._
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}
import security.WkEnv
import com.scalableminds.util.objectid.ObjectId

import scala.concurrent.ExecutionContext

case class ScriptParameters(
    name: String,
    gist: String,
    owner: ObjectId
)
object ScriptParameters {
  implicit val jsonFormat: OFormat[ScriptParameters] = Json.format[ScriptParameters]
}

class ScriptController @Inject() (
    scriptDAO: ScriptDAO,
    taskDAO: TaskDAO,
    scriptService: ScriptService,
    userService: UserService,
    sil: Silhouette[WkEnv]
)(implicit ec: ExecutionContext, bodyParsers: PlayBodyParsers)
    extends Controller {

  def create: Action[ScriptParameters] = sil.SecuredAction.async(validateJson[ScriptParameters]) { implicit request =>
    for {
      isTeamManagerOrAdmin <- userService.isTeamManagerOrAdminOfOrg(request.identity, request.identity._organization)
      _ <- Fox.fromBool(isTeamManagerOrAdmin) ?~> Msg.notAllowed ~> FORBIDDEN
      _ <- Fox.fromBool(request.body.owner == request.identity._id) ?~> Msg.notAllowed ~> FORBIDDEN
      _ <- scriptService.assertValidScriptName(request.body.name)
      script = Script(
        _id = ObjectId.generate,
        _owner = request.body.owner,
        name = request.body.name,
        gist = request.body.gist
      )
      _ <- scriptDAO.insertOne(script)
      js <- scriptService.publicWrites(script) ?~> Msg.Script.publicWritesFailed
    } yield Ok(js)
  }

  def get(scriptId: ObjectId): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      script <- scriptDAO.findOne(scriptId) ?~> Msg.Script.notFound(scriptId) ~> NOT_FOUND
      js <- scriptService.publicWrites(script) ?~> Msg.Script.publicWritesFailed
    } yield Ok(js)
  }

  def list: Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      scripts <- scriptDAO.findAll
      js <- Fox.serialCombined(scripts)(s => scriptService.publicWrites(s))
    } yield Ok(Json.toJson(js))
  }

  def update(scriptId: ObjectId): Action[ScriptParameters] =
    sil.SecuredAction.async(validateJson[ScriptParameters]) { implicit request =>
      for {
        oldScript <- scriptDAO.findOne(scriptId) ?~> Msg.Script.notFound(scriptId) ~> NOT_FOUND
        _ <- Fox.fromBool(oldScript._owner == request.identity._id) ?~> Msg.Script.updateOnlyOwner ~> FORBIDDEN
        _ <- scriptService.assertValidScriptName(request.body.name)
        _ <- Fox.runIf(request.body.owner != oldScript._owner)(
          userService.findOneCached(request.body.owner)
        ) ?~> Msg.User.notFound(request.body.owner)
        updatedScript = oldScript.copy(name = request.body.name, gist = request.body.gist, _owner = request.body.owner)
        _ <- scriptDAO.updateOne(updatedScript)
        js <- scriptService.publicWrites(updatedScript) ?~> Msg.Script.publicWritesFailed
      } yield Ok(js)
    }

  def delete(scriptId: ObjectId): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      oldScript <- scriptDAO.findOne(scriptId) ?~> Msg.Script.notFound(scriptId) ~> NOT_FOUND
      _ <- Fox.fromBool(oldScript._owner == request.identity._id) ?~> Msg.Script.deleteOnlyOwner ~> FORBIDDEN
      _ <- scriptDAO.deleteOne(scriptId) ?~> Msg.Script.deleteFailed
      _ <- taskDAO.removeScriptFromAllTasks(scriptId) ?~> Msg.Script.deleteFailed
    } yield Ok
  }
}
