/*
 * Copyright (C) 2011-2017 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package controllers
import javax.inject.Inject
import com.scalableminds.util.reactivemongo.GlobalAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.project._
import models.task._
import models.user.UserDAO
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
        projects <- ProjectSQLDAO.findAll
        js <- Fox.serialCombined(projects)(_.publicWrites)
      } yield {
        Ok(Json.toJson(js))
      }
  }

  def listWithStatus = SecuredAction.async {
    implicit request =>
      for {
        projects <- ProjectSQLDAO.findAll
        allCounts <- TaskSQLDAO.countAllOpenInstancesGroupedByProjects
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
        project <- ProjectSQLDAO.findOneByName(projectName) ?~> Messages("project.notFound", projectName)
        js <- project.publicWrites
      } yield {
        Ok(js)
      }
  }

  def delete(projectName: String) = SecuredAction.async {
    implicit request =>
      for {
        project <- ProjectSQLDAO.findOneByName(projectName) ?~> Messages("project.notFound", projectName)
        _ <- project.isDeletableBy(request.identity) ?~> Messages("project.remove.notAllowed")
        _ <- ProjectService.deleteOne(project._id) ?~> Messages("project.remove.failure")
      } yield {
        JsonOk(Messages("project.remove.success"))
      }
  }

  def create = SecuredAction.async(parse.json) { implicit request =>
    withJsonBodyUsing(ProjectSQL.projectPublicReads) { project =>
      ProjectSQLDAO.findOneByName(project.name)(GlobalAccessContext).futureBox.flatMap {
        case Empty =>
          for {
            teamIdBson <- project._team.toBSONObjectId.toFox
            _ <- request.identity.assertTeamManagerOrAdminOf(teamIdBson) ?~> "team.notAllowed"
            _ <- ProjectSQLDAO.insertOne(project)
            js <- project.publicWrites
          } yield Ok(js)
        case _ =>
          Future.successful(JsonBadRequest(Messages("project.name.alreadyTaken")))
      }
    }
  }

  def update(projectName: String) = SecuredAction.async(parse.json) { implicit request =>
    withJsonBodyUsing(ProjectSQL.projectPublicReads) { updateRequest =>
      for{
        project <- ProjectSQLDAO.findOneByName(projectName)(GlobalAccessContext) ?~> Messages("project.notFound", projectName)
        teamIdBson <- project._team.toBSONObjectId.toFox
        _ <- request.identity.assertTeamManagerOrAdminOf(teamIdBson) ?~> Messages("team.notAllowed")
        _ <- ProjectSQLDAO.updateOne(updateRequest.copy(_id = project._id, paused = project.paused)) ?~> Messages("project.update.failed", projectName)
        updated <- ProjectSQLDAO.findOneByName(projectName)
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
      project <- ProjectSQLDAO.findOneByName(projectName) ?~> Messages("project.notFound", projectName)
      _ <- ProjectSQLDAO.updatePaused(project._id, isPaused) ?~> Messages("project.update.failed", projectName)
      updatedProject <- ProjectSQLDAO.findOne(project._id) ?~> Messages("project.notFound", projectName)
      js <- updatedProject.publicWrites
    } yield {
      Ok(js)
    }
  }

  def tasksForProject(projectName: String) = SecuredAction.async {
    implicit request =>
      for {
        project <- ProjectSQLDAO.findOneByName(projectName) ?~> Messages("project.notFound", projectName)
        teamIdBson <- project._team.toBSONObjectId.toFox
        _ <- request.identity.assertTeamManagerOrAdminOf(teamIdBson) ?~> Messages("notAllowed")
        tasks <- TaskSQLDAO.findAllByProject(project._id)(GlobalAccessContext)
        js <- Fox.serialCombined(tasks)(_.publicWrites)
      } yield {
        Ok(Json.toJson(js))
      }
  }

  def incrementEachTasksInstances(projectName: String, delta: Option[Long]) = SecuredAction.async {
    implicit request =>
      for {
        _ <- (delta.getOrElse(1L) >= 0) ?~> Messages("project.increaseTaskInstances.negative")
        project <- ProjectSQLDAO.findOneByName(projectName) ?~> Messages("project.notFound", projectName)
        _ <- TaskSQLDAO.incrementTotalInstancesOfAllWithProject(project._id, delta.getOrElse(1L))
        openInstanceCount <- TaskSQLDAO.countOpenInstancesForProject(project._id)
        js <- project.publicWritesWithStatus(openInstanceCount)
      } yield Ok(js)
  }

  def usersWithOpenTasks(projectName: String) = SecuredAction.async {
    implicit request =>
      for {
        emails <- ProjectSQLDAO.findUsersWithOpenTasks(projectName)
      } yield {
        Ok(Json.toJson(emails))
      }
  }
}
