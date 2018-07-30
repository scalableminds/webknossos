/*
 * Copyright (C) 2011-2017 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package controllers
import javax.inject.Inject
import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.project._
import models.task._
import net.liftweb.common.Empty
import oxalis.security.WebknossosSilhouette.{SecuredAction, SecuredRequest}
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.Json

import scala.concurrent.Future

class ProjectController @Inject()(val messagesApi: MessagesApi) extends Controller with FoxImplicits {

  def list = SecuredAction.async {
    implicit request =>
      for {
        projects <- ProjectDAO.findAll
        js <- Fox.serialCombined(projects)(_.publicWrites)
      } yield {
        Ok(Json.toJson(js))
      }
  }

  def listWithStatus = SecuredAction.async {
    implicit request =>
      for {
        projects <- ProjectDAO.findAll
        allCounts <- TaskDAO.countAllOpenInstancesGroupedByProjects
        js <- Fox.serialCombined(projects) { project =>
          for {
            openTaskInstances <- Fox.successful(allCounts.get(project._id).getOrElse(0))
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
        _ <- project.isDeletableBy(request.identity) ?~> Messages("project.remove.notAllowed")
        _ <- ProjectService.deleteOne(project._id) ?~> Messages("project.remove.failure")
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
            _ <- ProjectDAO.insertOne(project)
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
        _ <- ensureTeamAdministration(request.identity, project._team) ?~> Messages("notAllowed")
        tasks <- TaskDAO.findAllByProject(project._id)(GlobalAccessContext)
        js <- Fox.serialCombined(tasks)(_.publicWrites)
      } yield {
        Ok(Json.toJson(js))
      }
  }

  def incrementEachTasksInstances(projectName: String, delta: Option[Long]) = SecuredAction.async {
    implicit request =>
      for {
        _ <- (delta.getOrElse(1L) >= 0) ?~> Messages("project.increaseTaskInstances.negative")
        project <- ProjectDAO.findOneByName(projectName) ?~> Messages("project.notFound", projectName)
        _ <- TaskDAO.incrementTotalInstancesOfAllWithProject(project._id, delta.getOrElse(1L))
        openInstanceCount <- TaskDAO.countOpenInstancesForProject(project._id)
        js <- project.publicWritesWithStatus(openInstanceCount)
      } yield Ok(js)
  }

  def usersWithOpenTasks(projectName: String) = SecuredAction.async {
    implicit request =>
      for {
        emails <- ProjectDAO.findUsersWithOpenTasks(projectName)
      } yield {
        Ok(Json.toJson(emails))
      }
  }
}
