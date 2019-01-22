package controllers
import javax.inject.Inject
import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.annotation.{AnnotationDAO, AnnotationService, AnnotationType}
import models.project._
import models.task._
import models.user.UserService
import net.liftweb.common.Empty
import oxalis.security.WkEnv
import com.mohiva.play.silhouette.api.Silhouette
import com.mohiva.play.silhouette.api.actions.{SecuredRequest, UserAwareRequest}
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.json.Json
import utils.ObjectId

import scala.concurrent.{ExecutionContext, Future}

class ProjectController @Inject()(projectService: ProjectService,
                                  projectDAO: ProjectDAO,
                                  annotationService: AnnotationService,
                                  annotationDAO: AnnotationDAO,
                                  taskDAO: TaskDAO,
                                  userService: UserService,
                                  taskService: TaskService,
                                  sil: Silhouette[WkEnv])(implicit ec: ExecutionContext)
    extends Controller
    with FoxImplicits {

  def list = sil.SecuredAction.async { implicit request =>
    for {
      projects <- projectDAO.findAll ?~> "project.list.failed"
      js <- Fox.serialCombined(projects)(p => projectService.publicWrites(p))
    } yield {
      Ok(Json.toJson(js))
    }
  }

  def listWithStatus = sil.SecuredAction.async { implicit request =>
    for {
      projects <- projectDAO.findAll ?~> "project.list.failed"
      allCounts <- taskDAO.countAllOpenInstancesGroupedByProjects
      js <- Fox.serialCombined(projects) { project =>
        for {
          openTaskInstances <- Fox.successful(allCounts.getOrElse(project._id, 0))
          r <- projectService.publicWritesWithStatus(project, openTaskInstances)
        } yield r
      }
    } yield {
      Ok(Json.toJson(js))
    }
  }

  def read(projectName: String) = sil.SecuredAction.async { implicit request =>
    for {
      project <- projectDAO.findOneByName(projectName) ?~> Messages("project.notFound", projectName)
      js <- projectService.publicWrites(project)
    } yield {
      Ok(js)
    }
  }

  def delete(projectName: String) = sil.SecuredAction.async { implicit request =>
    for {
      project <- projectDAO.findOneByName(projectName) ?~> Messages("project.notFound", projectName)
      _ <- bool2Fox(project.isDeletableBy(request.identity)) ?~> "project.remove.notAllowed"
      _ <- projectService.deleteOne(project._id) ?~> "project.remove.failure"
    } yield {
      JsonOk(Messages("project.remove.success"))
    }
  }

  def create = sil.SecuredAction.async(parse.json) { implicit request =>
    withJsonBodyUsing(Project.projectPublicReads) { project =>
      projectDAO.findOneByName(project.name)(GlobalAccessContext).futureBox.flatMap {
        case Empty =>
          for {
            _ <- Fox.assertTrue(userService.isTeamManagerOrAdminOf(request.identity, project._team))
            _ <- projectDAO.insertOne(project) ?~> "project.creation.failed"
            js <- projectService.publicWrites(project)
          } yield Ok(js)
        case _ =>
          Future.successful(JsonBadRequest(Messages("project.name.alreadyTaken")))
      }
    }
  }

  def update(projectName: String) = sil.SecuredAction.async(parse.json) { implicit request =>
    withJsonBodyUsing(Project.projectPublicReads) { updateRequest =>
      for {
        project <- projectDAO.findOneByName(projectName)(GlobalAccessContext) ?~> Messages("project.notFound",
                                                                                           projectName)
        _ <- Fox.assertTrue(userService.isTeamManagerOrAdminOf(request.identity, project._team))
        _ <- projectDAO.updateOne(updateRequest.copy(_id = project._id, paused = project.paused)) ?~> Messages(
          "project.update.failed",
          projectName)
        updated <- projectDAO.findOneByName(projectName)
        js <- projectService.publicWrites(updated)
      } yield Ok(js)
    }
  }

  def pause(projectName: String) = sil.SecuredAction.async { implicit request =>
    updatePauseStatus(projectName, isPaused = true)
  }

  def resume(projectName: String) = sil.SecuredAction.async { implicit request =>
    updatePauseStatus(projectName, isPaused = false)
  }

  private def updatePauseStatus(projectName: String, isPaused: Boolean)(implicit request: SecuredRequest[WkEnv, _]) =
    for {
      project <- projectDAO.findOneByName(projectName) ?~> Messages("project.notFound", projectName)
      _ <- Fox.assertTrue(userService.isTeamManagerOrAdminOf(request.identity, project._team))
      _ <- projectDAO.updatePaused(project._id, isPaused) ?~> Messages("project.update.failed", projectName)
      updatedProject <- projectDAO.findOne(project._id) ?~> Messages("project.notFound", projectName)
      js <- projectService.publicWrites(updatedProject)
    } yield {
      Ok(js)
    }

  def tasksForProject(projectName: String, limit: Option[Int] = None, pageNumber: Option[Int] = None) = sil.SecuredAction.async { implicit request =>
    for {
      project <- projectDAO.findOneByName(projectName) ?~> Messages("project.notFound", projectName)
      _ <- Fox.assertTrue(userService.isTeamManagerOrAdminOf(request.identity, project._team)) ?~> "notAllowed"
      tasks <- taskDAO.findAllByProject(project._id, limit.getOrElse(Int.MaxValue), pageNumber.getOrElse(0))(GlobalAccessContext)
      js <- Fox.serialCombined(tasks)(task => taskService.publicWrites(task))
    } yield {
      Ok(Json.toJson(js))
    }
  }

  def incrementEachTasksInstances(projectName: String, delta: Option[Long]) = sil.SecuredAction.async {
    implicit request =>
      for {
        _ <- bool2Fox(delta.getOrElse(1L) >= 0) ?~> "project.increaseTaskInstances.negative"
        project <- projectDAO.findOneByName(projectName) ?~> Messages("project.notFound", projectName)
        _ <- taskDAO.incrementTotalInstancesOfAllWithProject(project._id, delta.getOrElse(1L))
        openInstanceCount <- taskDAO.countOpenInstancesForProject(project._id)
        js <- projectService.publicWritesWithStatus(project, openInstanceCount)
      } yield Ok(js)
  }

  def usersWithActiveTasks(projectName: String) = sil.SecuredAction.async { implicit request =>
    for {
      _ <- projectDAO.findOneByName(projectName) ?~> Messages("project.notFound", projectName)
      usersWithActiveTasks <- projectDAO.findUsersWithActiveTasks(projectName)
    } yield {
      Ok(Json.toJson(usersWithActiveTasks.map(tuple => Json.obj("email" -> tuple._1, "activeTasks" -> tuple._2))))
    }
  }

  def transferActiveTasks(projectName: String) = sil.SecuredAction.async(parse.json) { implicit request =>
    for {
      project <- projectDAO.findOneByName(projectName) ?~> Messages("project.notFound", projectName)
      _ <- Fox.assertTrue(userService.isTeamManagerOrAdminOf(request.identity, project._team)) ?~> "notAllowed"
      newUserId <- (request.body \ "userId").asOpt[String].toFox ?~> "user.id.notFound"
      newUserIdValidated <- ObjectId.parse(newUserId)
      activeAnnotations <- annotationDAO.findAllActiveForProject(project._id)
      updated <- Fox.serialCombined(activeAnnotations) { id =>
        annotationService.transferAnnotationToUser(AnnotationType.Task.toString,
                                                   id.toString,
                                                   newUserIdValidated,
                                                   request.identity)
      }
    } yield Ok

  }
}
