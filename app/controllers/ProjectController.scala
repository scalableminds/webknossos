/*
 * Copyright (C) 2011-2017 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package controllers
import javax.inject.Inject

import com.scalableminds.util.reactivemongo.GlobalAccessContext
import com.scalableminds.util.tools.Fox
import models.annotation.AnnotationDAO
import models.project.{Project, ProjectDAO, ProjectService}
import models.task._
import models.user.UserDAO
import net.liftweb.common.Empty
import oxalis.security.WebknossosSilhouette.{SecuredAction, SecuredRequest}
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.Json

import scala.concurrent.Future

class ProjectController @Inject()(val messagesApi: MessagesApi) extends Controller {

  def list = SecuredAction.async {
    implicit request =>
      for {
        projects <- ProjectDAO.findAll
        js <- Fox.serialSequence(projects)(Project.projectPublicWrites(_, request.identity))
      } yield {
        Ok(Json.toJson(js))
      }
  }

  def listWithStatus = SecuredAction.async {
    implicit request =>
      for {
        projects <- ProjectDAO.findAll
        allCounts <- TaskDAO.countOpenInstancesByProjects
        js <- Fox.serialCombined(projects) { project =>
          for {
            openTaskInstances <- Fox.successful(allCounts.get(project.name).getOrElse(0))
            r <- Project.projectPublicWritesWithStatus(project, openTaskInstances, request.identity)
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
        js <- Project.projectPublicWrites(project, request.identity)
      } yield {
        Ok(js)
      }
  }

  def delete(projectName: String) = SecuredAction.async {
    implicit request =>
      for {
        project <- ProjectDAO.findOneByName(projectName) ?~> Messages("project.notFound", projectName)
        _ <- project.isOwnedBy(request.identity) ?~> Messages("project.remove.notAllowed")
        _ <- ProjectService.remove(project) ?~> Messages("project.remove.failure")
      } yield {
        JsonOk(Messages("project.remove.success"))
      }
  }

  def create = SecuredAction.async(parse.json) { implicit request =>
    withJsonBodyUsing(Project.projectPublicReads) { project =>
      ProjectDAO.findOneByName(project.name)(GlobalAccessContext).futureBox.flatMap {
        case Empty if request.identity.isSuperVisorOf(project._team) =>
          for {
            _ <- ProjectDAO.insert(project)
            js <- Project.projectPublicWrites(project, request.identity)
          } yield Ok(js)
        case Empty =>
          Future.successful(JsonBadRequest(Messages("team.notAllowed")))
        case _ =>
          Future.successful(JsonBadRequest(Messages("project.name.alreadyTaken")))
      }
    }
  }

  def update(projectName: String) = SecuredAction.async(parse.json) { implicit request =>
    withJsonBodyUsing(Project.projectPublicReads) { updateRequest =>
      for{
        project <- ProjectDAO.findOneByName(projectName)(GlobalAccessContext) ?~> Messages("project.notFound", projectName)
        _ <- request.identity.supervisorTeamIds.contains(project._team) ?~> Messages("team.notAllowed")
        updatedProject <- ProjectService.update(project._id, project, updateRequest) ?~> Messages("project.update.failed", projectName)
        js <- Project.projectPublicWrites(updatedProject, request.identity)
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
      updatedProject <- ProjectService.updatePauseStatus(project, isPaused) ?~> Messages("project.update.failed", projectName)
      js <- Project.projectPublicWrites(updatedProject, request.identity)
    } yield {
      Ok(js)
    }
  }

  def tasksForProject(projectName: String) = SecuredAction.async {
    implicit request =>
      for {
        project <- ProjectDAO.findOneByName(projectName) ?~> Messages("project.notFound", projectName)
        _ <- request.identity.supervisorTeamIds.contains(project._team) ?~> Messages("notAllowed")
        tasks <- project.tasks
        js <- Fox.serialCombined(tasks)(t => Task.transformToJson(t))
      } yield {
        Ok(Json.toJson(js))
      }
  }

  def usersWithOpenTasks(projectName: String) = SecuredAction.async {
    implicit request =>
      for {
        tasks <- TaskDAO.findAllByProject(projectName)
        annotations <- AnnotationDAO.findAllUnfinishedByTaskIds(tasks.map(_._id)) //TODO
        userIds = annotations.map(_._user).flatten
        users <- UserDAO.findAllByIds(userIds)
      } yield {
        Ok(Json.toJson(users.map(_.email)))
      }
  }
}
