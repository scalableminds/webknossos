package controllers
import play.silhouette.api.Silhouette
import play.silhouette.api.actions.SecuredRequest
import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}

import javax.inject.Inject
import models.annotation.{AnnotationDAO, AnnotationService, AnnotationType}
import models.project._
import models.task._
import models.user.UserService
import play.api.i18n.Messages
import play.api.libs.json.{JsValue, Json}
import play.api.mvc.{AbstractController, Action, AnyContent, ControllerComponents}
import security.WkEnv
import com.scalableminds.util.objectid.ObjectId

import scala.concurrent.ExecutionContext

class ProjectController @Inject() (
    projectService: ProjectService,
    projectDAO: ProjectDAO,
    annotationService: AnnotationService,
    annotationDAO: AnnotationDAO,
    taskDAO: TaskDAO,
    taskTypeDAO: TaskTypeDAO,
    userService: UserService,
    taskService: TaskService,
    sil: Silhouette[WkEnv],
    cc: ControllerComponents
)(implicit ec: ExecutionContext)
    extends AbstractController(cc)
    with WkControllerUtils
    with FoxImplicits {

  def list: Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      projects <- projectDAO.findAll ?~> "project.list.failed"
      js <- Fox.serialCombined(projects)(p => projectService.publicWrites(p))
    } yield Ok(Json.toJson(js))
  }

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

  def read(id: ObjectId): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      project <- projectDAO.findOne(id) ?~> "project.notFound" ~> NOT_FOUND
      js <- projectService.publicWrites(project)
    } yield Ok(js)
  }

  def readByName(name: String): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        project <- projectDAO.findOneByNameAndOrganization(
          name,
          request.identity._organization
        ) ?~> "project.notFound" ~> NOT_FOUND
        js <- projectService.publicWrites(project)
      } yield Ok(js)
    }

  def delete(id: ObjectId): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      project <- projectDAO.findOne(id) ?~> "project.notFound" ~> NOT_FOUND
      _ <- bool2Fox(project.isDeletableBy(request.identity)) ?~> "project.remove.notAllowed" ~> FORBIDDEN
      _ <- projectService.deleteOne(project._id) ?~> "project.remove.failure"
    } yield JsonOk(Messages("project.remove.success"))
  }

  def create: Action[JsValue] = sil.SecuredAction.async(parse.json) { implicit request =>
    withJsonBodyUsing(Project.projectPublicReads) { project =>
      for {
        _ <- projectDAO
          .findOneByNameAndOrganization(project.name, request.identity._organization)(GlobalAccessContext)
          .reverse ?~> Messages("project.name.alreadyTaken", project.name)
        _ <- Fox.assertTrue(
          userService.isTeamManagerOrAdminOf(request.identity, project._team)
        ) ?~> "notAllowed" ~> FORBIDDEN
        _ <- projectDAO.insertOne(project, request.identity._organization) ?~> "project.creation.failed"
        js <- projectService.publicWrites(project)
      } yield Ok(js)
    }
  }

  def update(id: ObjectId): Action[JsValue] = sil.SecuredAction.async(parse.json) { implicit request =>
    withJsonBodyUsing(Project.projectPublicReads) { updateRequest =>
      for {
        project <- projectDAO.findOne(id)(GlobalAccessContext) ?~> "project.notFound" ~> NOT_FOUND
        _ <- Fox.assertTrue(
          userService.isTeamManagerOrAdminOf(request.identity, project._team)
        ) ?~> "notAllowed" ~> FORBIDDEN
        _ <- projectDAO.updateOne(
          updateRequest.copy(name = project.name, _id = project._id, paused = project.paused)
        ) ?~> "project.update.failed"
        updated <- projectDAO.findOne(id)
        js <- projectService.publicWrites(updated)
      } yield Ok(js)
    }
  }

  def pause(id: ObjectId): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    updatePauseStatus(id, isPaused = true)
  }

  def resume(id: ObjectId): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    updatePauseStatus(id, isPaused = false)
  }

  private def updatePauseStatus(id: ObjectId, isPaused: Boolean)(implicit request: SecuredRequest[WkEnv, ?]) =
    for {
      project <- projectDAO.findOne(id) ?~> "project.notFound" ~> NOT_FOUND
      _ <- Fox.assertTrue(
        userService.isTeamManagerOrAdminOf(request.identity, project._team)
      ) ?~> "notAllowed" ~> FORBIDDEN
      _ <- projectDAO.updatePaused(project._id, isPaused) ?~> "project.update.failed"
      updatedProject <- projectDAO.findOne(id)
      js <- projectService.publicWrites(updatedProject)
    } yield Ok(js)

  def projectsForTaskType(taskTypeId: ObjectId): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      _ <- taskTypeDAO.findOne(taskTypeId) ?~> "taskType.notFound" ~> NOT_FOUND
      projects <- projectDAO.findAllWithTaskType(taskTypeId.toString) ?~> "project.list.failed"
      allCounts <- taskDAO.countPendingInstancesAndTimeByProject
      js <- Fox.serialCombined(projects) { project =>
        for {
          pendingInstancesAndTime <- Fox.successful(allCounts.getOrElse(project._id, (0L, 0L)))
          r <- projectService.publicWritesWithStatus(project, pendingInstancesAndTime._1, pendingInstancesAndTime._2)
        } yield r
      }
    } yield Ok(Json.toJson(js))
  }

  def tasksForProject(
      id: ObjectId,
      limit: Option[Int] = None,
      pageNumber: Option[Int] = None,
      includeTotalCount: Option[Boolean]
  ): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        project <- projectDAO.findOne(id) ?~> "project.notFound" ~> NOT_FOUND
        _ <- Fox.assertTrue(
          userService.isTeamManagerOrAdminOf(request.identity, project._team)
        ) ?~> "notAllowed" ~> FORBIDDEN
        tasks <- taskDAO.findAllByProject(project._id, limit.getOrElse(Int.MaxValue), pageNumber.getOrElse(0))
        taskCount <- Fox.runIf(includeTotalCount.getOrElse(false))(
          taskDAO.countAllByProject(project._id)(GlobalAccessContext)
        )
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
        _ <- bool2Fox(delta.getOrElse(1L) >= 0) ?~> "project.increaseTaskInstances.negative"
        project <- projectDAO.findOne(id) ?~> "project.notFound" ~> NOT_FOUND
        _ <- taskDAO.incrementTotalInstancesOfAllWithProject(project._id, delta.getOrElse(1L))
        pendingInstancesAndTime <- taskDAO.countPendingInstancesAndTimeForProject(project._id)
        js <- projectService.publicWritesWithStatus(project, pendingInstancesAndTime._1, pendingInstancesAndTime._2)
      } yield Ok(js)
    }

  def usersWithActiveTasks(id: ObjectId): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      project <- projectDAO.findOne(id) ?~> "project.notFound" ~> NOT_FOUND
      usersWithActiveTasks <- projectDAO.findUsersWithActiveTasks(project._id)
    } yield Ok(
      Json.toJson(
        usersWithActiveTasks.map(tuple =>
          Json.obj("email" -> tuple._1, "firstName" -> tuple._2, "lastName" -> tuple._3, "activeTasks" -> tuple._4)
        )
      )
    )
  }

  def transferActiveTasks(id: ObjectId): Action[JsValue] = sil.SecuredAction.async(parse.json) { implicit request =>
    for {
      project <- projectDAO.findOne(id) ?~> "project.notFound" ~> NOT_FOUND
      _ <- Fox.assertTrue(
        userService.isTeamManagerOrAdminOf(request.identity, project._team)
      ) ?~> "notAllowed" ~> FORBIDDEN
      newUserId <- (request.body \ "userId").asOpt[String].toFox ?~> "user.id.notFound" ~> NOT_FOUND
      newUserIdValidated <- ObjectId.fromString(newUserId)
      activeAnnotations <- annotationDAO.findAllActiveForProject(project._id)
      _ <- Fox.serialCombined(activeAnnotations) { id =>
        annotationService.transferAnnotationToUser(
          AnnotationType.Task.toString,
          id,
          newUserIdValidated,
          request.identity
        )
      }
    } yield Ok

  }
}
