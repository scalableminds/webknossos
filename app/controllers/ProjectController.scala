/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package controllers

import javax.inject.Inject

import scala.concurrent.Future

import com.scalableminds.util.reactivemongo.GlobalAccessContext
import com.scalableminds.util.tools.Fox
import models.project.{Project, ProjectDAO, ProjectService}
import models.task._
import models.user.User
import net.liftweb.common.{Empty, Full}
import oxalis.security.{AuthenticatedRequest, Secured}
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.{JsValue, Json}
import play.twirl.api.Html

class ProjectController @Inject()(val messagesApi: MessagesApi) extends Controller with Secured {
  def empty(name: String) = Authenticated {
    implicit request =>
      Ok(views.html.main()(Html("")))
  }

  def list = Authenticated.async {
    implicit request =>
      for {
        projects <- ProjectDAO.findAll
        js <- Fox.serialSequence(projects)(Project.projectPublicWritesWithStatus(_, request.user))
      } yield {
        Ok(Json.toJson(js))
      }
  }

  def read(projectName: String) = Authenticated.async {
    implicit request =>
      for {
        project <- ProjectDAO.findOneByName(projectName) ?~> Messages("project.notFound", projectName)
        js <- Project.projectPublicWrites(project, request.user)
      } yield {
        Ok(js)
      }
  }

  def delete(projectName: String) = Authenticated.async {
    implicit request =>
      for {
        project <- ProjectDAO.findOneByName(projectName) ?~> Messages("project.notFound", projectName)
        _ <- project.isOwnedBy(request.user) ?~> Messages("project.remove.notAllowed")
        _ <- ProjectService.remove(project) ?~> Messages("project.remove.failure")
      } yield {
        JsonOk(Messages("project.remove.success"))
      }
  }

  def create = Authenticated.async(parse.json) { implicit request =>
    withJsonBodyUsing(Project.projectPublicReads) { project =>
      ProjectDAO.findOneByName(project.name)(GlobalAccessContext).futureBox.flatMap {
        case Empty if request.user.isAdminOf(project.team) =>
          for {
            _ <- ProjectService.reportToExternalService(project, request.body)
            _ <- ProjectDAO.insert(project)
            js <- Project.projectPublicWritesWithStatus(project, request.user)
          } yield Ok(js)
        case Empty                                                       =>
          Future.successful(JsonBadRequest(Messages("team.notAllowed")))
        case _                                                           =>
          Future.successful(JsonBadRequest(Messages("project.name.alreadyTaken")))
      }
    }
  }

  def update(projectName: String) = Authenticated.async(parse.json) { implicit request =>
    withJsonBodyUsing(Project.projectPublicReads) { updateRequest =>
      for{
        project <- ProjectDAO.findOneByName(projectName)(GlobalAccessContext) ?~> Messages("project.notFound", projectName)
        _ <- request.user.adminTeamNames.contains(project.team) ?~> Messages("team.notAllowed")
        updatedProject <- ProjectService.update(project._id, project, updateRequest) ?~> Messages("project.update.failed", projectName)
        js <- Project.projectPublicWritesWithStatus(updatedProject, request.user)
      } yield Ok(js)
    }
  }

  def pause(projectName: String) = Authenticated.async {
    implicit request =>
      updatePauseStatus(projectName, isPaused = true)
  }

  def resume(projectName: String) = Authenticated.async {
    implicit request =>
      updatePauseStatus(projectName, isPaused = false)
  }

  private def updatePauseStatus(projectName: String, isPaused: Boolean)(implicit request: AuthenticatedRequest[_]) = {
    for {
      project <- ProjectDAO.findOneByName(projectName) ?~> Messages("project.notFound", projectName)
      updatedProject <- ProjectService.updatePauseStatus(project, isPaused) ?~> Messages("project.update.failed", projectName)
      js <- Project.projectPublicWrites(updatedProject, request.user)
    } yield {
      Ok(js)
    }
  }

  def tasksForProject(projectName: String) = Authenticated.async {
    implicit request =>
      for {
        project <- ProjectDAO.findOneByName(projectName) ?~> Messages("project.notFound", projectName)
        tasks <- project.tasks
        js <- Fox.serialSequence(tasks)(t => Task.transformToJson(t, request.userOpt))
      } yield {
        Ok(Json.toJson(js))
      }
  }
}
