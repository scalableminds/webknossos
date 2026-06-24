package controllers

import com.scalableminds.util.Msg
import play.silhouette.api.Silhouette
import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.tracingstore.tracings.TracingType
import models.annotation.AnnotationSettings
import models.task._
import models.user.UserService
import play.api.libs.json.Reads._
import play.api.libs.json._
import com.scalableminds.util.objectid.ObjectId

import javax.inject.Inject
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}
import security.WkEnv

import scala.concurrent.ExecutionContext

case class TaskTypeParameters(
    summary: String,
    description: String,
    teamId: ObjectId,
    settings: AnnotationSettings,
    recommendedConfiguration: Option[JsValue],
    tracingType: TracingType.Value
)
object TaskTypeParameters {
  implicit val jsonFormat: OFormat[TaskTypeParameters] = Json.format[TaskTypeParameters]
}

class TaskTypeController @Inject() (
    taskTypeDAO: TaskTypeDAO,
    taskDAO: TaskDAO,
    taskTypeService: TaskTypeService,
    userService: UserService,
    sil: Silhouette[WkEnv]
)(implicit ec: ExecutionContext, playBodyParsers: PlayBodyParsers)
    extends Controller {

  def create: Action[TaskTypeParameters] = sil.SecuredAction.fox(validateJson[TaskTypeParameters]) {
    implicit request =>
      for {
        _ <- Fox.assertTrue(
          userService.isTeamManagerOrAdminOf(request.identity, request.body.teamId)
        ) ?~> Msg.notAllowed ~> FORBIDDEN
        _ <- taskTypeDAO
          .findOneBySummaryAndOrganization(request.body.summary, request.identity._organization)(using
            GlobalAccessContext
          )
          .reverse ?~> Msg.TaskType.summaryTaken(request.body.summary)
        _ <- taskTypeService.assertValidTaskTypeSummary(request.body.summary)
        taskType = TaskType(
          _id = ObjectId.generate,
          summary = request.body.summary,
          _team = request.body.teamId,
          description = request.body.description,
          settings = request.body.settings,
          recommendedConfiguration = request.body.recommendedConfiguration,
          tracingType = request.body.tracingType
        )
        _ <- taskTypeDAO.insertOne(taskType, request.identity._organization)
        js <- taskTypeService.publicWrites(taskType)
      } yield Ok(js)
  }

  def get(taskTypeId: ObjectId): Action[AnyContent] = sil.SecuredAction.fox { implicit request =>
    for {
      taskType <- taskTypeDAO.findOne(taskTypeId) ?~> Msg.TaskType.notFound(taskTypeId) ~> NOT_FOUND
      _ <- Fox.assertTrue(userService.isTeamManagerOrAdminOf(request.identity, taskType._team))
      js <- taskTypeService.publicWrites(taskType)
    } yield Ok(js)
  }

  def list: Action[AnyContent] = sil.SecuredAction.fox { implicit request =>
    for {
      taskTypes <- taskTypeDAO.findAll
      js <- Fox.serialCombined(taskTypes)(t => taskTypeService.publicWrites(t))
    } yield Ok(Json.toJson(js))
  }

  def update(taskTypeId: ObjectId): Action[TaskTypeParameters] =
    sil.SecuredAction.fox(validateJson[TaskTypeParameters]) { implicit request =>
      for {
        existing <- taskTypeDAO.findOne(taskTypeId) ?~> Msg.TaskType.notFound(taskTypeId) ~> NOT_FOUND
        _ <- Fox.fromBool(request.body.tracingType == existing.tracingType) ?~> Msg.TaskType.tracingTypeImmutable
        _ <- Fox.fromBool(
          request.body.settings.magRestrictions == existing.settings.magRestrictions
        ) ?~> Msg.TaskType.magRestrictionsImmutable
        _ <- Fox.assertTrue(
          userService.isTeamManagerOrAdminOf(request.identity, existing._team)
        ) ?~> Msg.notAllowed ~> FORBIDDEN
        _ <- Fox.assertTrue(
          userService.isTeamManagerOrAdminOf(request.identity, request.body.teamId)
        ) ?~> Msg.notAllowed ~> FORBIDDEN
        _ <- taskTypeService.assertValidTaskTypeSummary(request.body.summary)
        updated = existing.copy(
          summary = request.body.summary,
          _team = request.body.teamId,
          description = request.body.description,
          settings = request.body.settings,
          recommendedConfiguration = request.body.recommendedConfiguration
        )
        _ <- Fox.runIf(request.body.summary != existing.summary) {
          taskTypeDAO
            .findOneBySummaryAndOrganization(request.body.summary, request.identity._organization)(using
              GlobalAccessContext
            )
            .reverse ?~> Msg.TaskType.summaryTaken(request.body.summary)
        }
        _ <- taskTypeDAO.updateOne(updated)
        js <- taskTypeService.publicWrites(updated)
      } yield JsonOk(js, Msg.TaskType.editSuccess)
    }

  def delete(taskTypeId: ObjectId): Action[AnyContent] = sil.SecuredAction.fox { implicit request =>
    for {
      taskType <- taskTypeDAO.findOne(taskTypeId) ?~> Msg.TaskType.notFound(taskTypeId) ~> NOT_FOUND
      _ <- Fox.assertTrue(
        userService.isTeamManagerOrAdminOf(request.identity, taskType._team)
      ) ?~> Msg.notAllowed ~> FORBIDDEN
      _ <- taskTypeDAO.deleteOne(taskTypeId) ?~> Msg.TaskType.deleteFailed(taskType.summary)
      _ <- taskDAO.removeAllWithTaskTypeAndItsAnnotations(taskTypeId) ?~> Msg.TaskType.deleteFailed(taskType.summary)
      _ = logger.info(s"TaskType $taskTypeId was deleted.")
    } yield JsonOk(Msg.TaskType.deleteSuccess(taskType.summary))
  }
}
