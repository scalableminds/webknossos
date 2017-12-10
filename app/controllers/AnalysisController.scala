/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package controllers

import javax.inject.Inject

import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.annotation.{AnnotationDAO, AnnotationType}
import models.project.{Project, ProjectDAO}
import models.task.{OpenAssignment, TaskDAO, TaskService}
import models.team.TeamDAO
import models.user.{User, UserDAO}
import oxalis.security.WebknossosSilhouette.SecuredAction
import play.api.i18n.MessagesApi
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.Json


case class OpenTasksEntry(user: String, totalAssignments: Int, assignmentsByProjects: Map[String, Int])
object OpenTasksEntry { implicit val jsonFormat = Json.format[OpenTasksEntry] }

case class ProjectProgressEntry(projectName: String, totalTasks: Int, totalInstances: Int, openInstances: Int,
                                finishedInstances: Int, inProgressInstances: Int)
object ProjectProgressEntry { implicit val jsonFormat = Json.format[ProjectProgressEntry] }

class AnalysisController @Inject()(val messagesApi: MessagesApi) extends Controller with FoxImplicits {


  def projectProgressOverview = SecuredAction.async { implicit request =>
    for {
      projects <- ProjectDAO.findAll //todo: filter criteria
      i <- Fox.combined(projects.map(progressOfProject))
    } yield {
      val k = i
      Ok(Json.toJson(i))
    }
  }

  def progressOfProject(project: Project)(implicit ctx: DBAccessContext) = {
    for {
      tasks <- TaskDAO.findAllByProject(project.name)
      totalTasks = tasks.length
      totalInstances = tasks.map(_.instances).sum
      finishedInstancesByTask <- Fox.combined(tasks.map(task => AnnotationDAO.countFinishedByTaskIdAndType(task._id, AnnotationType.Task)))
      finishedInstances = finishedInstancesByTask.sum
      inProgressInstancesByTask <- Fox.combined(tasks.map(task => AnnotationDAO.countUnfinishedByTaskIdAndType(task._id, AnnotationType.Task)))
      inProgressInstances = inProgressInstancesByTask.sum
      openInstances = totalInstances - finishedInstances - inProgressInstances
    } yield {
      ProjectProgressEntry(project.name, totalTasks, totalInstances, openInstances, finishedInstances, inProgressInstances)
    }
  }


  def openTasksOverview(id: String) = SecuredAction.async { implicit request =>
    for {
      team <- TeamDAO.findOneById(id)
      users <- UserDAO.findByTeams(List(team.name), true)
      stuff: List[OpenTasksEntry] <- getAllAvailableTaskCountsAndProjects(users)
    } yield {
      Ok(Json.toJson(stuff))
    }
  }


  def getAllAvailableTaskCountsAndProjects(users: Seq[User])(implicit ctx: DBAccessContext): Fox[List[OpenTasksEntry]] = {
    val foxes = users.map { user =>
      for {
        assignments <- TaskService.findAllAssignableFor(user, user.teamNames)
      } yield {
        OpenTasksEntry(user.name, assignments.length, getAssignmentsByProjectsProjectsFor(assignments))
      }
    }
    Fox.combined(foxes.toList)
  }

  def getAssignmentsByProjectsProjectsFor(assignments: List[OpenAssignment])(implicit ctx: DBAccessContext) = {
    val projects = assignments.map(a => a._project + "/" + a.neededExperience.toString)
    projects.groupBy(identity).mapValues(_.size)
  }

}
