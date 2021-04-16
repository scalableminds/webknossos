package controllers

import com.mohiva.play.silhouette.api.Silhouette
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.tracingstore.tracings.TracingType
import models.annotation.AnnotationSettings
import models.task._
import models.user.UserService
import oxalis.security.WkEnv
import play.api.i18n.Messages
import play.api.libs.functional.syntax._
import play.api.libs.json.Reads._
import play.api.libs.json._
import utils.ObjectId
import javax.inject.Inject
import play.api.mvc.{Action, AnyContent}

import scala.concurrent.ExecutionContext

class TaskTypeController @Inject()(taskTypeDAO: TaskTypeDAO,
                                   taskDAO: TaskDAO,
                                   taskTypeService: TaskTypeService,
                                   userService: UserService,
                                   sil: Silhouette[WkEnv])(implicit ec: ExecutionContext)
    extends Controller
    with FoxImplicits {

  private val taskTypePublicReads =
    ((__ \ 'summary).read[String](minLength[String](2) or maxLength[String](50)) and
      (__ \ 'description).read[String] and
      (__ \ 'teamId).read[String](ObjectId.stringObjectIdReads("teamId")) and
      (__ \ 'settings).read[AnnotationSettings] and
      (__ \ 'recommendedConfiguration).readNullable[JsValue] and
      (__ \ 'tracingType).read[TracingType.Value])(taskTypeService.fromForm _)

  def create: Action[JsValue] = sil.SecuredAction.async(parse.json) { implicit request =>
    withJsonBodyUsing(taskTypePublicReads) { taskType =>
      for {
        _ <- Fox.assertTrue(userService.isTeamManagerOrAdminOf(request.identity, taskType._team)) ?~> "notAllowed" ~> FORBIDDEN
        _ <- taskTypeDAO.insertOne(taskType, request.identity._organization)
        js <- taskTypeService.publicWrites(taskType)
      } yield Ok(js)
    }
  }

  def get(taskTypeId: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      taskTypeIdValidated <- ObjectId.parse(taskTypeId) ?~> "taskType.id.invalid"
      taskType <- taskTypeDAO.findOne(taskTypeIdValidated) ?~> "taskType.notFound" ~> NOT_FOUND
      _ <- Fox.assertTrue(userService.isTeamManagerOrAdminOf(request.identity, taskType._team))
      js <- taskTypeService.publicWrites(taskType)
    } yield Ok(js)
  }

  def list: Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      taskTypes <- taskTypeDAO.findAll
      js <- Fox.serialCombined(taskTypes)(t => taskTypeService.publicWrites(t))
    } yield Ok(Json.toJson(js))
  }

  def update(taskTypeId: String): Action[JsValue] = sil.SecuredAction.async(parse.json) { implicit request =>
    withJsonBodyUsing(taskTypePublicReads) { taskTypeFromForm =>
      for {
        taskTypeIdValidated <- ObjectId.parse(taskTypeId) ?~> "taskType.id.invalid"
        taskType <- taskTypeDAO.findOne(taskTypeIdValidated) ?~> "taskType.notFound" ~> NOT_FOUND
        _ <- bool2Fox(taskTypeFromForm.tracingType == taskType.tracingType) ?~> "taskType.tracingTypeImmutable"
        _ <- bool2Fox(taskTypeFromForm.settings.resolutionRestrictions == taskType.settings.resolutionRestrictions) ?~> "taskType.resolutionRestrictionsImmutable"
        updatedTaskType = taskTypeFromForm.copy(_id = taskType._id)
        _ <- Fox.assertTrue(userService.isTeamManagerOrAdminOf(request.identity, taskType._team)) ?~> "notAllowed" ~> FORBIDDEN
        _ <- Fox
          .assertTrue(userService.isTeamManagerOrAdminOf(request.identity, updatedTaskType._team)) ?~> "notAllowed" ~> FORBIDDEN
        _ <- taskTypeDAO.updateOne(updatedTaskType)
        js <- taskTypeService.publicWrites(updatedTaskType)
      } yield JsonOk(js, Messages("taskType.editSuccess"))
    }
  }

  def delete(taskTypeId: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      taskTypeIdValidated <- ObjectId.parse(taskTypeId) ?~> "taskType.id.invalid"
      taskType <- taskTypeDAO.findOne(taskTypeIdValidated) ?~> "taskType.notFound" ~> NOT_FOUND
      _ <- Fox
        .assertTrue(userService.isTeamManagerOrAdminOf(request.identity, taskType._team)) ?~> "notAllowed" ~> FORBIDDEN
      _ <- taskTypeDAO.deleteOne(taskTypeIdValidated) ?~> "taskType.deleteFailure"
      _ <- taskDAO.removeAllWithTaskTypeAndItsAnnotations(taskTypeIdValidated) ?~> "taskType.deleteFailure"
      _ = logger.info(s"TaskType $taskTypeId was deleted.")
    } yield JsonOk(Messages("taskType.deleteSuccess", taskType.summary))
  }
}
