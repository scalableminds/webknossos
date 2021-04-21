package controllers
import com.mohiva.play.silhouette.api.Silhouette
import com.mohiva.play.silhouette.api.actions.SecuredRequest
import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.tools.DefaultConverters.BoolToOption
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import javax.inject.Inject
import models.annotation.{AnnotationDAO, AnnotationService, AnnotationType}
import models.project._
import models.task._
import models.user.UserService
import oxalis.security.WkEnv
import play.api.i18n.Messages
import play.api.libs.json.{JsValue, Json}
import play.api.mvc.{Action, AnyContent}
import utils.ObjectId

import scala.concurrent.ExecutionContext

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

  def list: Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      projects <- projectDAO.findAll ?~> "project.list.failed"
      js <- Fox.serialCombined(projects)(p => projectService.publicWrites(p))
    } yield Ok(Json.toJson(js))
  }

  def listWithStatus: Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      projects <- projectDAO.findAll ?~> "project.list.failed"
      allCounts <- taskDAO.countOpenInstancesAndTimeByProject
      js <- Fox.serialCombined(projects) { project =>
        for {
          openInstancesAndTime <- Fox.successful(allCounts.getOrElse(project._id, (0, 0L)))
          r <- projectService.publicWritesWithStatus(project, openInstancesAndTime._1, openInstancesAndTime._2)
        } yield r
      }
    } yield Ok(Json.toJson(js))
  }

  def read(id: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      projectIdValidated <- ObjectId.parse(id)
      project <- projectDAO.findOne(projectIdValidated) ?~> "project.notFound" ~> NOT_FOUND
      js <- projectService.publicWrites(project)
    } yield Ok(js)
  }

  def delete(id: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      projectIdValidated <- ObjectId.parse(id)
      project <- projectDAO.findOne(projectIdValidated) ?~> "project.notFound" ~> NOT_FOUND
      _ <- bool2Fox(project.isDeletableBy(request.identity)) ?~> "project.remove.notAllowed" ~> FORBIDDEN
      _ <- projectService.deleteOne(project._id) ?~> "project.remove.failure"
    } yield JsonOk(Messages("project.remove.success"))
  }

  def create: Action[JsValue] = sil.SecuredAction.async(parse.json) { implicit request =>
    withJsonBodyUsing(Project.projectPublicReads) { project =>
      for {
        _ <- projectDAO
          .findOneByNameAndOrganization(project.name, request.identity._organization)(GlobalAccessContext)
          .reverse ?~> "project.name.alreadyTaken"
        _ <- Fox
          .assertTrue(userService.isTeamManagerOrAdminOf(request.identity, project._team)) ?~> "notAllowed" ~> FORBIDDEN
        _ <- projectDAO.insertOne(project, request.identity._organization) ?~> "project.creation.failed"
        js <- projectService.publicWrites(project)
      } yield Ok(js)
    }
  }

  def update(id: String): Action[JsValue] = sil.SecuredAction.async(parse.json) { implicit request =>
    withJsonBodyUsing(Project.projectPublicReads) { updateRequest =>
      for {
        projectIdValidated <- ObjectId.parse(id)
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

  def pause(id: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    updatePauseStatus(id, isPaused = true)
  }

  def resume(id: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    updatePauseStatus(id, isPaused = false)
  }

  private def updatePauseStatus(id: String, isPaused: Boolean)(implicit request: SecuredRequest[WkEnv, _]) =
    for {
      projectIdValidated <- ObjectId.parse(id)
      project <- projectDAO.findOne(projectIdValidated) ?~> "project.notFound" ~> NOT_FOUND
      _ <- Fox.assertTrue(userService.isTeamManagerOrAdminOf(request.identity, project._team)) ?~> "notAllowed" ~> FORBIDDEN
      _ <- projectDAO.updatePaused(project._id, isPaused) ?~> "project.update.failed"
      updatedProject <- projectDAO.findOne(projectIdValidated)
      js <- projectService.publicWrites(updatedProject)
    } yield Ok(js)

  def projectsForTaskType(taskTypeId: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      taskTypeIdValidated <- ObjectId.parse(taskTypeId)
      _ <- taskTypeDAO.findOne(taskTypeIdValidated) ?~> "taskType.notFound" ~> NOT_FOUND
      projects <- projectDAO.findAllWithTaskType(taskTypeId) ?~> "project.list.failed"
      allCounts <- taskDAO.countOpenInstancesAndTimeByProject
      js <- Fox.serialCombined(projects) { project =>
        for {
          openInstancesAndTime <- Fox.successful(allCounts.getOrElse(project._id, (0, 0L)))
          r <- projectService.publicWritesWithStatus(project, openInstancesAndTime._1, openInstancesAndTime._2)
        } yield r
      }
    } yield {
      Ok(Json.toJson(js))
    }
  }

  def tasksForProject(id: String,
                      limit: Option[Int] = None,
                      pageNumber: Option[Int] = None,
                      includeTotalCount: Option[Boolean]): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        projectIdValidated <- ObjectId.parse(id)
        project <- projectDAO.findOne(projectIdValidated) ?~> "project.notFound" ~> NOT_FOUND
        _ <- Fox.assertTrue(userService.isTeamManagerOrAdminOf(request.identity, project._team)) ?~> "notAllowed" ~> FORBIDDEN
        tasks <- taskDAO.findAllByProject(project._id, limit.getOrElse(Int.MaxValue), pageNumber.getOrElse(0))
        taskCount <- Fox.runOptional(includeTotalCount.flatMap(BoolToOption.convert))(_ =>
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

  def incrementEachTasksInstances(id: String, delta: Option[Long]): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        _ <- bool2Fox(delta.getOrElse(1L) >= 0) ?~> "project.increaseTaskInstances.negative"
        projectIdValidated <- ObjectId.parse(id)
        project <- projectDAO.findOne(projectIdValidated) ?~> "project.notFound" ~> NOT_FOUND
        _ <- taskDAO.incrementTotalInstancesOfAllWithProject(project._id, delta.getOrElse(1L))
        openInstancesAndTime <- taskDAO.countOpenInstancesAndTimeForProject(project._id)
        js <- projectService.publicWritesWithStatus(project, openInstancesAndTime._1, openInstancesAndTime._2)
      } yield Ok(js)
    }

  def usersWithActiveTasks(id: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      projectIdValidated <- ObjectId.parse(id)
      project <- projectDAO.findOne(projectIdValidated) ?~> "project.notFound" ~> NOT_FOUND
      usersWithActiveTasks <- projectDAO.findUsersWithActiveTasks(project._id)
    } yield {
      Ok(Json.toJson(usersWithActiveTasks.map(tuple =>
        Json.obj("email" -> tuple._1, "firstName" -> tuple._2, "lastName" -> tuple._3, "activeTasks" -> tuple._4))))
    }
  }

  def transferActiveTasks(id: String): Action[JsValue] = sil.SecuredAction.async(parse.json) { implicit request =>
    for {
      projectIdValidated <- ObjectId.parse(id)
      project <- projectDAO.findOne(projectIdValidated) ?~> "project.notFound" ~> NOT_FOUND
      _ <- Fox
        .assertTrue(userService.isTeamManagerOrAdminOf(request.identity, project._team)) ?~> "notAllowed" ~> FORBIDDEN
      newUserId <- (request.body \ "userId").asOpt[String].toFox ?~> "user.id.notFound" ~> NOT_FOUND
      newUserIdValidated <- ObjectId.parse(newUserId)
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
