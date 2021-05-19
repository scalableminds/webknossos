package models.task

import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.mvc.Formatter
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import javax.inject.Inject
import models.annotation.{Annotation, AnnotationDAO, AnnotationType}
import models.binary.DataSetDAO
import models.project.ProjectDAO
import models.team.TeamDAO
import models.user.{User, UserService}
import play.api.i18n.{Messages, MessagesProvider}
import play.api.libs.json.{JsObject, Json}
import utils.{ObjectId, WkConf}

import scala.concurrent.ExecutionContext

class TaskService @Inject()(conf: WkConf,
                            dataSetDAO: DataSetDAO,
                            scriptDAO: ScriptDAO,
                            userService: UserService,
                            annotationDAO: AnnotationDAO,
                            taskTypeDAO: TaskTypeDAO,
                            teamDAO: TeamDAO,
                            scriptService: ScriptService,
                            taskTypeService: TaskTypeService,
                            projectDAO: ProjectDAO)(implicit ec: ExecutionContext)
    extends FoxImplicits {

  def publicWrites(task: Task)(implicit ctx: DBAccessContext): Fox[JsObject] =
    for {
      annotationBase <- annotationBaseFor(task._id)
      dataSet <- dataSetDAO.findOne(annotationBase._dataSet)
      status <- statusOf(task).getOrElse(CompletionStatus(-1, -1, -1))
      taskType <- taskTypeDAO.findOne(task._taskType)(GlobalAccessContext)
      taskTypeJs <- taskTypeService.publicWrites(taskType)
      scriptInfo <- task._script.toFox.flatMap(sid => scriptDAO.findOne(sid)).futureBox
      scriptJs <- scriptInfo.toFox.flatMap(s => scriptService.publicWrites(s)).futureBox
      project <- projectDAO.findOne(task._project)
      team <- teamDAO.findOne(project._team)(GlobalAccessContext)
    } yield {
      Json.obj(
        "id" -> task._id.toString,
        "formattedHash" -> Formatter.formatHash(task._id.toString),
        "projectName" -> project.name,
        "team" -> team.name,
        "type" -> taskTypeJs,
        "dataSet" -> dataSet.name,
        "neededExperience" -> task.neededExperience,
        "created" -> task.created,
        "status" -> status,
        "script" -> scriptJs.toOption,
        "tracingTime" -> task.tracingTime,
        "creationInfo" -> task.creationInfo,
        "boundingBox" -> task.boundingBox,
        "editPosition" -> task.editPosition,
        "editRotation" -> task.editRotation
      )
    }

  def getAllowedTeamsForNextTask(user: User)(implicit ctx: DBAccessContext,
                                             m: MessagesProvider): Fox[List[ObjectId]] = {
    if (user.isAdmin) return teamDAO.findAllIdsByOrganization(user._organization)
    for {
      numberOfOpen <- countOpenNonAdminTasks(user)
      teams <- if (numberOfOpen < conf.WebKnossos.Tasks.maxOpenPerUser) userService.teamIdsFor(user._id)
      else userService.teamManagerTeamIdsFor(user._id)
      _ <- bool2Fox(teams.nonEmpty) ?~> Messages("task.tooManyOpenOnes")
    } yield teams
  }

  private def countOpenNonAdminTasks(user: User)(implicit ctx: DBAccessContext) =
    for {
      teamManagerTeamIds <- userService.teamManagerTeamIdsFor(user._id)
      result <- annotationDAO.countActiveAnnotationsFor(user._id, AnnotationType.Task, teamManagerTeamIds)
    } yield result

  def annotationBaseFor(taskId: ObjectId)(implicit ctx: DBAccessContext): Fox[Annotation] =
    (for {
      list <- annotationDAO.findAllByTaskIdAndType(taskId, AnnotationType.TracingBase)
    } yield list.headOption.toFox).flatten

  def statusOf(task: Task)(implicit ctx: DBAccessContext): Fox[CompletionStatus] =
    for {
      active <- countActiveAnnotationsFor(task._id).getOrElse(0)
    } yield CompletionStatus(task.openInstances, active, task.totalInstances - (active + task.openInstances))

  def countActiveAnnotationsFor(taskId: ObjectId)(implicit ctx: DBAccessContext): Fox[Int] =
    annotationDAO.countActiveByTask(taskId, AnnotationType.Task)

}
