/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package controllers

import oxalis.security.Secured
import braingames.reactivemongo.GlobalAccessContext
import models.user.{User, UserService}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.templates.Html
import scala.concurrent.Future
import models.task.{Task, Project, ProjectService, ProjectDAO}
import play.api.libs.json.{JsError, JsSuccess, Writes, Json}
import play.api.i18n.Messages
import net.liftweb.common.{Empty, Failure, Full}

object ProjectController extends Controller with Secured {
  def empty = Authenticated{ implicit request =>
    Ok(views.html.main()(Html.empty))
  }

  def list = Authenticated.async {
    implicit request =>
      ProjectDAO.findAll.map {
        projects =>
          Ok(Writes.list(Project.projectPublicWrites).writes(projects))
      }
  }

  def ensureProjectOwnership(project: Project, user: User) = {
    project.isOwnedBy(user) match {
      case true => Full(true)
      case false => Empty
    }
  }

  def delete(projectName: String) = Authenticated.async {
    implicit request =>
      for {
        project <- ProjectDAO.findOneByName(projectName) ?~> Messages("project.notFound")
        _ <- ensureProjectOwnership(project, request.user) ?~> Messages("project.remove.notAllowed")
        _ <- ProjectService.remove(project) ?~> Messages("project.remove.failure")
      } yield {
        JsonOk(Messages("project.remove.success"))
      }
  }

  def create = Authenticated.async(parse.json){ implicit request =>
    request.body.validate(Project.projectPublicReads) match {
      case JsSuccess(project, _) =>
        ProjectDAO.findOneByName(project.name)(GlobalAccessContext).futureBox.flatMap{
          case Empty if request.user.adminTeamNames.contains(project.team) =>
            ProjectDAO.insert(project).map{ _ =>
              Ok(Project.projectPublicWrites.writes(project))
            }
          case Empty =>
            Future.successful(JsonBadRequest(Messages("team.notAllowed")))
          case _ =>
            Future.successful(JsonBadRequest(Messages("project.name.alreadyTaken")))
        }
      case e: JsError =>
        Future.successful(BadRequest(JsError.toFlatJson(e)))
    }
  }

  def tasksForProject(projectName: String) = Authenticated.async { implicit request =>
    for {
      project <- ProjectDAO.findOneByName(projectName) ?~> Messages("project.notFound")
      tasks <- project.tasks
      js <- Future.traverse(tasks)(Task.transformToJson)
    } yield {
      Ok(Json.toJson(js))
    }
  }
}
