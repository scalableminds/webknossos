package models.task

import com.scalableminds.util.Msg
import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.{Fox, FoxImplicits}

import javax.inject.Inject
import models.annotation.{Annotation, AnnotationDAO, AnnotationIdentifier, AnnotationStore, AnnotationType}
import models.dataset.DatasetDAO
import models.project.ProjectDAO
import models.team.TeamDAO
import models.user.{User, UserService}
import play.api.libs.json.{JsObject, Json}
import utils.WkConf

import scala.concurrent.ExecutionContext

class TaskService @Inject()(conf: WkConf,
                            datasetDAO: DatasetDAO,
                            scriptDAO: ScriptDAO,
                            annotationStore: AnnotationStore,
                            userService: UserService,
                            annotationDAO: AnnotationDAO,
                            taskTypeDAO: TaskTypeDAO,
                            teamDAO: TeamDAO,
                            taskDAO: TaskDAO,
                            scriptService: ScriptService,
                            taskTypeService: TaskTypeService,
                            projectDAO: ProjectDAO)(implicit ec: ExecutionContext)
    extends FoxImplicits {

  def publicWrites(task: Task)(using ctx: DBAccessContext): Fox[JsObject] =
    for {
      annotationBase <- annotationBaseFor(task._id)
      dataset <- datasetDAO.findOne(annotationBase._dataset)
      status <- Fox.fromFuture(statusOf(task).getOrElse(TaskStatus(-1, -1, -1)))
      taskType <- taskTypeDAO.findOne(task._taskType)(using GlobalAccessContext)
      taskTypeJs <- taskTypeService.publicWrites(taskType)
      scriptInfoBox <- task._script.toFox.flatMap(sid => scriptDAO.findOne(sid)).shiftBox
      scriptJsBox <- scriptInfoBox.toFox.flatMap(s => scriptService.publicWrites(s)).shiftBox
      project <- projectDAO.findOne(task._project)
      team <- teamDAO.findOne(project._team)(using GlobalAccessContext)
    } yield {
      Json.obj(
        "id" -> task._id.toString,
        "projectId" -> project._id.id,
        "projectName" -> project.name,
        "team" -> team.name,
        "type" -> taskTypeJs,
        "datasetName" -> dataset.name,
        "datasetId" -> dataset._id, // Only used for csv serialization in frontend.
        "neededExperience" -> task.neededExperience,
        "created" -> task.created,
        "status" -> status,
        "script" -> scriptJsBox.toOption,
        "tracingTime" -> task.tracingTime,
        "creationInfo" -> task.creationInfo,
        "boundingBox" -> task.boundingBox,
        "editPosition" -> task.editPosition,
        "editRotation" -> task.editRotation
      )
    }

  def getAllowedTeamsForNextTask(user: User)(using ctx: DBAccessContext): Fox[List[ObjectId]] =
    if (user.isAdmin)
      teamDAO.findAllIdsByOrganization(user._organization)
    else {
      for {
        numberOfOpen <- countOpenNonAdminTasks(user)
        teams <- if (numberOfOpen < conf.WebKnossos.Tasks.maxOpenPerUser) userService.teamIdsFor(user._id)
        else userService.teamManagerTeamIdsFor(user._id)
        _ <- Fox.fromBool(teams.nonEmpty) ?~> Msg.Task.tooManyOpenOnes
      } yield teams
    }

  private def countOpenNonAdminTasks(user: User)(using ctx: DBAccessContext) =
    for {
      teamManagerTeamIds <- userService.teamManagerTeamIdsFor(user._id)
      result <- annotationDAO.countActiveAnnotationsFor(user._id, AnnotationType.Task, teamManagerTeamIds)
    } yield result

  private def annotationBaseFor(taskId: ObjectId)(using ctx: DBAccessContext): Fox[Annotation] =
    (for {
      list <- annotationDAO.findAllByTaskIdAndType(taskId, AnnotationType.TracingBase)
    } yield list.headOption.toFox).flatten

  private def statusOf(task: Task)(using ctx: DBAccessContext): Fox[TaskStatus] =
    for {
      activeCount <- Fox.fromFuture(annotationDAO.countActiveByTask(task._id, AnnotationType.Task).getOrElse(0))
    } yield TaskStatus(task.pendingInstances, activeCount, task.totalInstances - (activeCount + task.pendingInstances))

  def clearCompoundCache(taskId: ObjectId): Fox[Unit] =
    for {
      task <- taskDAO.findOne(taskId)(using GlobalAccessContext)
      _ = annotationStore.removeFromCache(AnnotationIdentifier(AnnotationType.CompoundTask, task._id))
      _ = annotationStore.removeFromCache(AnnotationIdentifier(AnnotationType.CompoundProject, task._project))
      _ = annotationStore.removeFromCache(AnnotationIdentifier(AnnotationType.CompoundTaskType, task._taskType))
    } yield ()
}
