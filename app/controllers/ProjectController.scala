package controllers
import javax.inject.Inject
import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.annotation.{AnnotationDAO, AnnotationService, AnnotationType}
import models.project._
import models.task._
import net.liftweb.common.Empty
import oxalis.security.WebknossosSilhouette.{SecuredAction, SecuredRequest}
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.Json
import utils.ObjectId

import scala.concurrent.Future

class ProjectController @Inject()(val messagesApi: MessagesApi) extends Controller with FoxImplicits {

  def list = SecuredAction.async {
    implicit request =>
      for {
        projects <- ProjectDAO.findAll ?~> "project.list.failed"
        js <- Fox.serialCombined(projects)(_.publicWrites)
      } yield {
        Ok(Json.toJson(js))
      }
  }

  def listWithStatus = SecuredAction.async {
    implicit request =>
      for {
        projects <- ProjectDAO.findAll ?~> "project.list.failed"
        allCounts <- TaskDAO.countAllOpenInstancesGroupedByProjects
        js <- Fox.serialCombined(projects) { project =>
          for {
            openTaskInstances <- Fox.successful(allCounts.getOrElse(project._id, 0))
            r <- project.publicWritesWithStatus(openTaskInstances)
          } yield r
        }
      } yield {
        Ok(Json.toJson(js))
      }
  }

  def read(projectName: String) = SecuredAction.async {
    implicit request =>
      for {
        project <- ProjectDAO.findOneByName(projectName) ?~> Messages("project.notFound", projectName)
        js <- project.publicWrites
      } yield {
        Ok(js)
      }
  }

  def delete(projectName: String) = SecuredAction.async {
    implicit request =>
      for {
        project <- ProjectDAO.findOneByName(projectName) ?~> Messages("project.notFound", projectName)
        _ <- bool2Fox(project.isDeletableBy(request.identity)) ?~> "project.remove.notAllowed"
        _ <- ProjectService.deleteOne(project._id) ?~> "project.remove.failure"
      } yield {
        JsonOk(Messages("project.remove.success"))
      }
  }

  def create = SecuredAction.async(parse.json) { implicit request =>
    withJsonBodyUsing(Project.projectPublicReads) { project =>
      ProjectDAO.findOneByName(project.name)(GlobalAccessContext).futureBox.flatMap {
        case Empty =>
          for {
            _ <- ensureTeamAdministration(request.identity, project._team)
            _ <- ProjectDAO.insertOne(project) ?~> "project.creation.failed"
            js <- project.publicWrites
          } yield Ok(js)
        case _ =>
          Future.successful(JsonBadRequest(Messages("project.name.alreadyTaken")))
      }
    }
  }

  def update(projectName: String) = SecuredAction.async(parse.json) { implicit request =>
    withJsonBodyUsing(Project.projectPublicReads) { updateRequest =>
      for{
        project <- ProjectDAO.findOneByName(projectName)(GlobalAccessContext) ?~> Messages("project.notFound", projectName)
        _ <- ensureTeamAdministration(request.identity, project._team)
        _ <- ProjectDAO.updateOne(updateRequest.copy(_id = project._id, paused = project.paused)) ?~> Messages("project.update.failed", projectName)
        updated <- ProjectDAO.findOneByName(projectName)
        js <- updated.publicWrites
      } yield Ok(js)
    }
  }

  def pause(projectName: String) = SecuredAction.async {
    implicit request =>
      updatePauseStatus(projectName, isPaused = true)
  }

  def resume(projectName: String) = SecuredAction.async {
    implicit request =>
      updatePauseStatus(projectName, isPaused = false)
  }

  private def updatePauseStatus(projectName: String, isPaused: Boolean)(implicit request: SecuredRequest[_]) = {
    for {
      project <- ProjectDAO.findOneByName(projectName) ?~> Messages("project.notFound", projectName)
      _ <- ensureTeamAdministration(request.identity, project._team)
      _ <- ProjectDAO.updatePaused(project._id, isPaused) ?~> Messages("project.update.failed", projectName)
      updatedProject <- ProjectDAO.findOne(project._id) ?~> Messages("project.notFound", projectName)
      js <- updatedProject.publicWrites
    } yield {
      Ok(js)
    }
  }

  def tasksForProject(projectName: String) = SecuredAction.async {
    implicit request =>
      for {
        project <- ProjectDAO.findOneByName(projectName) ?~> Messages("project.notFound", projectName)
        _ <- ensureTeamAdministration(request.identity, project._team) ?~> "notAllowed"
        tasks <- TaskDAO.findAllByProject(project._id)(GlobalAccessContext)
        js <- Fox.serialCombined(tasks)(_.publicWrites)
      } yield {
        Ok(Json.toJson(js))
      }
  }

  def incrementEachTasksInstances(projectName: String, delta: Option[Long]) = SecuredAction.async {
    implicit request =>
      for {
        _ <- bool2Fox(delta.getOrElse(1L) >= 0) ?~> "project.increaseTaskInstances.negative"
        project <- ProjectDAO.findOneByName(projectName) ?~> Messages("project.notFound", projectName)
        _ <- TaskDAO.incrementTotalInstancesOfAllWithProject(project._id, delta.getOrElse(1L))
        openInstanceCount <- TaskDAO.countOpenInstancesForProject(project._id)
        js <- project.publicWritesWithStatus(openInstanceCount)
      } yield Ok(js)
  }

  def usersWithActiveTasks(projectName: String) = SecuredAction.async {
    implicit request =>
      for {
        _ <- ProjectDAO.findOneByName(projectName) ?~> Messages("project.notFound", projectName)
        usersWithActiveTasks <- ProjectDAO.findUsersWithActiveTasks(projectName)
      } yield {
        Ok(Json.toJson(usersWithActiveTasks.map(tuple  => Json.obj("email" -> tuple._1, "activeTasks" -> tuple._2))))
      }
  }

  def transferActiveTasks(projectName: String) = SecuredAction.async(parse.json) { implicit request =>
    for {
      project <- ProjectDAO.findOneByName(projectName) ?~> Messages("project.notFound", projectName)
      _ <- ensureTeamAdministration(request.identity, project._team) ?~> "notAllowed"
      newUserId <- (request.body \ "userId").asOpt[String].toFox ?~> "user.id.notFound"
      newUserIdValidated <- ObjectId.parse(newUserId) ?~> "user.id.invalid"
      activeAnnotations <- AnnotationDAO.findAllActiveForProject(project._id)
      updated <- Fox.serialCombined(activeAnnotations){ id =>
        AnnotationService.transferAnnotationToUser(AnnotationType.Task.toString, id.toString, newUserIdValidated)(securedRequestToUserAwareRequest)
      }
    } yield Ok

  }
}
