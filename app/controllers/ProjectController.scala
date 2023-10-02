package controllers
import com.mohiva.play.silhouette.api.Silhouette
import com.mohiva.play.silhouette.api.actions.SecuredRequest
import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import io.swagger.annotations._
import javax.inject.Inject
import models.annotation.{AnnotationDAO, AnnotationService, AnnotationType}
import models.project._
import models.task._
import models.user.UserService
import play.api.i18n.Messages
import play.api.libs.json.{JsObject, JsValue, Json}
import play.api.mvc.{Action, AnyContent}
import security.WkEnv
import utils.ObjectId

import scala.concurrent.ExecutionContext

@Api
class ProjectController @Inject()(projectService: ProjectService,
                                  projectDAO: ProjectDAO,
                                  annotationService: AnnotationService,
                                  annotationDAO: AnnotationDAO,
                                  taskDAO: TaskDAO,
                                  taskTypeDAO: TaskTypeDAO,
                                  userService: UserService,
                                  taskService: TaskService,
                                  sil: Silhouette[WkEnv])(implicit ec: ExecutionContext)
    extends Controller
    with FoxImplicits {

  @ApiOperation(hidden = true, value = "")
  def list: Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      projects <- projectDAO.findAll ?~> "project.list.failed"
      js <- Fox.serialCombined(projects)(p => projectService.publicWrites(p))
    } yield Ok(Json.toJson(js))
  }

  @ApiOperation(hidden = true, value = "")
  def listWithStatus: Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      projects <- projectDAO.findAll ?~> "project.list.failed"
      allCounts <- taskDAO.countPendingInstancesAndTimeByProject
      js <- Fox.serialCombined(projects) { project =>
        for {
          pendingInstancesAndTime <- Fox.successful(allCounts.getOrElse(project._id, (0L, 0L)))
          r <- projectService.publicWritesWithStatus(project, pendingInstancesAndTime._1, pendingInstancesAndTime._2)
        } yield r
      }
    } yield Ok(Json.toJson(js))
  }

  @ApiOperation(value = "Information about a project selected by id", nickname = "projectInfoById")
  @ApiResponses(
    Array(new ApiResponse(code = 200, message = "JSON object containing information about this project."),
          new ApiResponse(code = 400, message = badRequestLabel)))
  def read(@ApiParam(value = "The id of the project") id: String): Action[AnyContent] = sil.SecuredAction.async {
    implicit request =>
      for {
        projectIdValidated <- ObjectId.fromString(id)
        project <- projectDAO.findOne(projectIdValidated) ?~> "project.notFound" ~> NOT_FOUND
        js <- projectService.publicWrites(project)
      } yield Ok(js)
  }

  @ApiOperation(value = "Information about a project selected by name", nickname = "projectInfoByName")
  @ApiResponses(
    Array(new ApiResponse(code = 200, message = "JSON object containing information about this project."),
          new ApiResponse(code = 400, message = badRequestLabel)))
  def readByName(@ApiParam(value = "The name of the project") name: String): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        project <- projectDAO.findOneByNameAndOrganization(name, request.identity._organization) ?~> "project.notFound" ~> NOT_FOUND
        js <- projectService.publicWrites(project)
      } yield Ok(js)
    }

  @ApiOperation(hidden = true, value = "")
  def delete(id: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      projectIdValidated <- ObjectId.fromString(id)
      project <- projectDAO.findOne(projectIdValidated) ?~> "project.notFound" ~> NOT_FOUND
      _ <- bool2Fox(project.isDeletableBy(request.identity)) ?~> "project.remove.notAllowed" ~> FORBIDDEN
      _ <- projectService.deleteOne(project._id) ?~> "project.remove.failure"
    } yield JsonOk(Messages("project.remove.success"))
  }

  @ApiOperation(
    value =
      """Create a new Project.
Expects:
 - As JSON object body with keys:
  - name (string) name of the new project
  - team (string) id of the team this project is for
  - priority (int) priority of the project’s tasks
  - paused (bool, default=False) if the project should be paused at time of creation (its tasks are not distributed)
  - expectedTime (int, optional) time limit
  - owner (string) id of a user
  - isBlacklistedFromReport (boolean) if true, the project is skipped on the progress report tables
""",
    nickname = "createProject"
  )
  @ApiImplicitParams(
    Array(
      new ApiImplicitParam(name = "ProjectParameters",
                           required = true,
                           dataTypeClass = classOf[JsObject],
                           paramType = "body")))
  def create: Action[JsValue] = sil.SecuredAction.async(parse.json) { implicit request =>
    withJsonBodyUsing(Project.projectPublicReads) { project =>
      for {
        _ <- projectDAO
          .findOneByNameAndOrganization(project.name, request.identity._organization)(GlobalAccessContext)
          .reverse ?~> Messages("project.name.alreadyTaken", project.name)
        _ <- Fox
          .assertTrue(userService.isTeamManagerOrAdminOf(request.identity, project._team)) ?~> "notAllowed" ~> FORBIDDEN
        _ <- projectDAO.insertOne(project, request.identity._organization) ?~> "project.creation.failed"
        js <- projectService.publicWrites(project)
      } yield Ok(js)
    }
  }

  @ApiOperation(hidden = true, value = "")
  def update(id: String): Action[JsValue] = sil.SecuredAction.async(parse.json) { implicit request =>
    withJsonBodyUsing(Project.projectPublicReads) { updateRequest =>
      for {
        projectIdValidated <- ObjectId.fromString(id)
        project <- projectDAO.findOne(projectIdValidated)(GlobalAccessContext) ?~> "project.notFound" ~> NOT_FOUND
        _ <- Fox
          .assertTrue(userService.isTeamManagerOrAdminOf(request.identity, project._team)) ?~> "notAllowed" ~> FORBIDDEN
        _ <- projectDAO
          .updateOne(updateRequest.copy(name = project.name, _id = project._id, paused = project.paused)) ?~> "project.update.failed"
        updated <- projectDAO.findOne(projectIdValidated)
        js <- projectService.publicWrites(updated)
      } yield Ok(js)
    }
  }

  @ApiOperation(hidden = true, value = "")
  def pause(id: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    updatePauseStatus(id, isPaused = true)
  }

  @ApiOperation(hidden = true, value = "")
  def resume(id: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    updatePauseStatus(id, isPaused = false)
  }

  @ApiOperation(hidden = true, value = "")
  private def updatePauseStatus(id: String, isPaused: Boolean)(implicit request: SecuredRequest[WkEnv, _]) =
    for {
      projectIdValidated <- ObjectId.fromString(id)
      project <- projectDAO.findOne(projectIdValidated) ?~> "project.notFound" ~> NOT_FOUND
      _ <- Fox.assertTrue(userService.isTeamManagerOrAdminOf(request.identity, project._team)) ?~> "notAllowed" ~> FORBIDDEN
      _ <- projectDAO.updatePaused(project._id, isPaused) ?~> "project.update.failed"
      updatedProject <- projectDAO.findOne(projectIdValidated)
      js <- projectService.publicWrites(updatedProject)
    } yield Ok(js)

  @ApiOperation(hidden = true, value = "")
  def projectsForTaskType(taskTypeId: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      taskTypeIdValidated <- ObjectId.fromString(taskTypeId)
      _ <- taskTypeDAO.findOne(taskTypeIdValidated) ?~> "taskType.notFound" ~> NOT_FOUND
      projects <- projectDAO.findAllWithTaskType(taskTypeId) ?~> "project.list.failed"
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

  @ApiOperation(value = "Information about the tasks of a project selected by project id",
                nickname = "taskInfosByProjectId")
  @ApiResponses(
    Array(
      new ApiResponse(code = 200,
                      message = "JSON list of objects containing information about the tasks of this project project."),
      new ApiResponse(code = 400, message = badRequestLabel)
    ))
  def tasksForProject(
      @ApiParam(value = "Id of the project") id: String,
      @ApiParam(value = "Pagination: limit for the number of tasks to query") limit: Option[Int] = None,
      @ApiParam(value = "Pagination: page number, skip the first tasks") pageNumber: Option[Int] = None,
      @ApiParam(value = "Pagination: if true, include total count in response header as X-Total-Count") includeTotalCount: Option[
        Boolean]): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        projectIdValidated <- ObjectId.fromString(id)
        project <- projectDAO.findOne(projectIdValidated) ?~> "project.notFound" ~> NOT_FOUND
        _ <- Fox.assertTrue(userService.isTeamManagerOrAdminOf(request.identity, project._team)) ?~> "notAllowed" ~> FORBIDDEN
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

  @ApiOperation(hidden = true, value = "")
  def incrementEachTasksInstances(id: String, delta: Option[Long]): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        _ <- bool2Fox(delta.getOrElse(1L) >= 0) ?~> "project.increaseTaskInstances.negative"
        projectIdValidated <- ObjectId.fromString(id)
        project <- projectDAO.findOne(projectIdValidated) ?~> "project.notFound" ~> NOT_FOUND
        _ <- taskDAO.incrementTotalInstancesOfAllWithProject(project._id, delta.getOrElse(1L))
        pendingInstancesAndTime <- taskDAO.countPendingInstancesAndTimeForProject(project._id)
        js <- projectService.publicWritesWithStatus(project, pendingInstancesAndTime._1, pendingInstancesAndTime._2)
      } yield Ok(js)
    }

  @ApiOperation(hidden = true, value = "")
  def usersWithActiveTasks(id: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      projectIdValidated <- ObjectId.fromString(id)
      project <- projectDAO.findOne(projectIdValidated) ?~> "project.notFound" ~> NOT_FOUND
      usersWithActiveTasks <- projectDAO.findUsersWithActiveTasks(project._id)
    } yield {
      Ok(Json.toJson(usersWithActiveTasks.map(tuple =>
        Json.obj("email" -> tuple._1, "firstName" -> tuple._2, "lastName" -> tuple._3, "activeTasks" -> tuple._4))))
    }
  }

  @ApiOperation(hidden = true, value = "")
  def transferActiveTasks(id: String): Action[JsValue] = sil.SecuredAction.async(parse.json) { implicit request =>
    for {
      projectIdValidated <- ObjectId.fromString(id)
      project <- projectDAO.findOne(projectIdValidated) ?~> "project.notFound" ~> NOT_FOUND
      _ <- Fox
        .assertTrue(userService.isTeamManagerOrAdminOf(request.identity, project._team)) ?~> "notAllowed" ~> FORBIDDEN
      newUserId <- (request.body \ "userId").asOpt[String].toFox ?~> "user.id.notFound" ~> NOT_FOUND
      newUserIdValidated <- ObjectId.fromString(newUserId)
      activeAnnotations <- annotationDAO.findAllActiveForProject(project._id)
      _ <- Fox.serialCombined(activeAnnotations) { id =>
        annotationService.transferAnnotationToUser(AnnotationType.Task.toString,
                                                   id.toString,
                                                   newUserIdValidated,
                                                   request.identity)
      }
    } yield Ok

  }
}
