package controllers
import com.scalableminds.util.Msg
import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.annotation.{AnnotationDAO, AnnotationService, AnnotationType}
import models.project._
import models.task._
import models.user.UserService
import play.api.libs.json.{Json, OFormat}
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}
import play.silhouette.api.Silhouette
import play.silhouette.api.actions.SecuredRequest
import security.WkEnv

import javax.inject.Inject
import scala.concurrent.ExecutionContext

case class ProjectParameters(name: String,
                             team: ObjectId,
                             priority: Int,
                             paused: Option[Boolean],
                             expectedTime: Option[Long],
                             owner: ObjectId,
                             isBlacklistedFromReport: Boolean)
object ProjectParameters {
  implicit val jsonFormat: OFormat[ProjectParameters] = Json.format[ProjectParameters]
}

case class TransferActiveTasksParameters(userId: ObjectId)
object TransferActiveTasksParameters {
  implicit val jsonFormat: OFormat[TransferActiveTasksParameters] = Json.format[TransferActiveTasksParameters]
}

class ProjectController @Inject()(
    projectService: ProjectService,
    projectDAO: ProjectDAO,
    annotationService: AnnotationService,
    annotationDAO: AnnotationDAO,
    taskDAO: TaskDAO,
    taskTypeDAO: TaskTypeDAO,
    userService: UserService,
    taskService: TaskService,
    sil: Silhouette[WkEnv])(implicit ec: ExecutionContext, playBodyParsers: PlayBodyParsers)
    extends Controller
    with FoxImplicits {

  def list: Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      projects <- projectDAO.findAll ?~> Msg.Project.listFailed
      js <- Fox.serialCombined(projects)(p => projectService.publicWrites(p))
    } yield Ok(Json.toJson(js))
  }

  def listWithStatus: Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      projects <- projectDAO.findAll ?~> Msg.Project.listFailed
      allCounts <- taskDAO.countPendingInstancesAndTimeByProject
      js <- Fox.serialCombined(projects) { project =>
        for {
          pendingInstancesAndTime <- Fox.successful(allCounts.getOrElse(project._id, (0L, 0L)))
          r <- projectService.publicWritesWithStatus(project, pendingInstancesAndTime._1, pendingInstancesAndTime._2)
        } yield r
      }
    } yield Ok(Json.toJson(js))
  }

  def read(id: ObjectId): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      project <- projectDAO.findOne(id) ?~> Msg.Project.notFound(id) ~> NOT_FOUND
      js <- projectService.publicWrites(project)
    } yield Ok(js)
  }

  def readByName(name: String): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        project <- projectDAO.findOneByNameAndOrganization(name, request.identity._organization) ?~> Msg.Project
          .notFound(name) ~> NOT_FOUND
        js <- projectService.publicWrites(project)
      } yield Ok(js)
    }

  def delete(id: ObjectId): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      project <- projectDAO.findOne(id) ?~> Msg.Project.notFound(id) ~> NOT_FOUND
      _ <- Fox.fromBool(project.isDeletableBy(request.identity)) ?~> Msg.Project.deleteNotAllowed ~> FORBIDDEN
      _ <- projectService.deleteOne(project._id) ?~> Msg.Project.deleteFailed
    } yield JsonOk(Msg.Project.deleteSuccess)
  }

  def create: Action[ProjectParameters] = sil.SecuredAction.async(validateJson[ProjectParameters]) { implicit request =>
    for {
      _ <- projectService.validateProjectName(request.body.name)
      _ <- projectDAO
        .findOneByNameAndOrganization(request.body.name, request.identity._organization)(GlobalAccessContext)
        .reverse ?~> Msg.Project.nameTaken(request.body.name)
      _ <- Fox
        .assertTrue(userService.isTeamManagerOrAdminOf(request.identity, request.body.team)) ?~> Msg.notAllowed ~> FORBIDDEN
      project = Project(
        _id = ObjectId.generate,
        _team = request.body.team,
        _owner = request.body.owner,
        name = request.body.name,
        priority = request.body.priority,
        paused = request.body.paused.getOrElse(false),
        expectedTime = request.body.expectedTime,
        isBlacklistedFromReport = request.body.isBlacklistedFromReport
      )
      _ <- projectDAO.insertOne(project, request.identity._organization) ?~> Msg.Project.createFailed
      js <- projectService.publicWrites(project)
    } yield Ok(js)
  }

  def update(id: ObjectId): Action[ProjectParameters] = sil.SecuredAction.async(validateJson[ProjectParameters]) {
    implicit request =>
      for {
        project: Project <- projectDAO.findOne(id)(GlobalAccessContext) ?~> Msg.Project.notFound(id) ~> NOT_FOUND
        _ <- Fox
          .assertTrue(userService.isTeamManagerOrAdminOf(request.identity, project._team)) ?~> Msg.notAllowed ~> FORBIDDEN
        updated = project.copy(
          _team = request.body.team,
          _owner = request.body.owner,
          priority = request.body.priority,
          expectedTime = request.body.expectedTime,
          isBlacklistedFromReport = request.body.isBlacklistedFromReport
        )
        _ <- projectDAO.updateOne(updated) ?~> Msg.Project.updateFailed
        updated <- projectDAO.findOne(id)
        js <- projectService.publicWrites(updated)
      } yield Ok(js)
  }

  def pause(id: ObjectId): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    updatePauseStatus(id, isPaused = true)
  }

  def resume(id: ObjectId): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    updatePauseStatus(id, isPaused = false)
  }

  private def updatePauseStatus(id: ObjectId, isPaused: Boolean)(implicit request: SecuredRequest[WkEnv, _]) =
    for {
      project <- projectDAO.findOne(id) ?~> Msg.Project.notFound(id) ~> NOT_FOUND
      _ <- Fox.assertTrue(userService.isTeamManagerOrAdminOf(request.identity, project._team)) ?~> Msg.notAllowed ~> FORBIDDEN
      _ <- projectDAO.updatePaused(project._id, isPaused) ?~> Msg.Project.updateFailed
      updatedProject <- projectDAO.findOne(id)
      js <- projectService.publicWrites(updatedProject)
    } yield Ok(js)

  def projectsForTaskType(taskTypeId: ObjectId): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      _ <- taskTypeDAO.findOne(taskTypeId) ?~> Msg.TaskType.notFound(taskTypeId) ~> NOT_FOUND
      projects <- projectDAO.findAllWithTaskType(taskTypeId.toString) ?~> Msg.Project.listFailed
      allCounts <- taskDAO.countPendingInstancesAndTimeByProject
      js <- Fox.serialCombined(projects) { project =>
        for {
          pendingInstancesAndTime <- Fox.successful(allCounts.getOrElse(project._id, (0L, 0L)))
          r <- projectService.publicWritesWithStatus(project, pendingInstancesAndTime._1, pendingInstancesAndTime._2)
        } yield r
      }
    } yield {
      Ok(Json.toJson(js))
    }
  }

  def tasksForProject(id: ObjectId,
                      limit: Option[Int] = None,
                      pageNumber: Option[Int] = None,
                      includeTotalCount: Option[Boolean]): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        project <- projectDAO.findOne(id) ?~> Msg.Project.notFound(id) ~> NOT_FOUND
        _ <- Fox.assertTrue(userService.isTeamManagerOrAdminOf(request.identity, project._team)) ?~> Msg.notAllowed ~> FORBIDDEN
        tasks <- taskDAO.findAllByProject(project._id, limit.getOrElse(Int.MaxValue), pageNumber.getOrElse(0))
        taskCount <- Fox.runIf(includeTotalCount.getOrElse(false))(
          taskDAO.countAllByProject(project._id)(GlobalAccessContext))
        js <- Fox.serialCombined(tasks)(task => taskService.publicWrites(task))
      } yield {
        val result = Ok(Json.toJson(js))
        taskCount match {
          case Some(count) => result.withHeaders("X-Total-Count" -> count.toString)
          case None        => result
        }
      }
    }

  def incrementEachTasksInstances(id: ObjectId, delta: Option[Long]): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        _ <- Fox.fromBool(delta.getOrElse(1L) >= 0) ?~> Msg.Project.increaseTaskInstancesNegative
        project <- projectDAO.findOne(id) ?~> Msg.Project.notFound(id) ~> NOT_FOUND
        _ <- taskDAO.incrementTotalInstancesOfAllWithProject(project._id, delta.getOrElse(1L))
        pendingInstancesAndTime <- taskDAO.countPendingInstancesAndTimeForProject(project._id)
        js <- projectService.publicWritesWithStatus(project, pendingInstancesAndTime._1, pendingInstancesAndTime._2)
      } yield Ok(js)
    }

  def usersWithActiveTasks(id: ObjectId): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      project <- projectDAO.findOne(id) ?~> Msg.Project.notFound(id) ~> NOT_FOUND
      usersWithActiveTasks <- projectDAO.findUsersWithActiveTasks(project._id)
    } yield {
      Ok(Json.toJson(usersWithActiveTasks.map(tuple =>
        Json.obj("email" -> tuple._1, "firstName" -> tuple._2, "lastName" -> tuple._3, "activeTasks" -> tuple._4))))
    }
  }

  def transferActiveTasks(id: ObjectId): Action[TransferActiveTasksParameters] =
    sil.SecuredAction.async(validateJson[TransferActiveTasksParameters]) { implicit request =>
      for {
        project <- projectDAO.findOne(id) ?~> Msg.Project.notFound(id) ~> NOT_FOUND
        _ <- Fox.assertTrue(userService.isTeamManagerOrAdminOf(request.identity, project._team)) ?~> Msg.notAllowed ~> FORBIDDEN
        _ <- userService.findOneCached(request.body.userId) ?~> Msg.User.notFound(request.body.userId)
        activeAnnotations <- annotationDAO.findAllActiveForProject(project._id)
        _ <- Fox.serialCombined(activeAnnotations) { id =>
          annotationService.transferAnnotationToUser(AnnotationType.Task.toString,
                                                     id,
                                                     request.body.userId,
                                                     request.identity)
        }
      } yield Ok

    }
}
