/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package controllers

import javax.inject.Inject

import com.scalableminds.util.reactivemongo.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.annotation.{AnnotationDAO, AnnotationType}
import models.project.{Project, ProjectDAO}
import models.task.{OpenAssignment, Task, TaskDAO, TaskService}
import models.team.{Team, TeamDAO}
import models.user.{Experience, User, UserDAO}
import oxalis.security.WebknossosSilhouette.SecuredAction
import play.api.i18n.MessagesApi
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.Json

import scala.concurrent.duration._


case class OpenTasksEntry(user: String, totalAssignments: Int, assignmentsByProjects: Map[String, Int])
object OpenTasksEntry { implicit val jsonFormat = Json.format[OpenTasksEntry] }

case class ProjectProgressEntry(projectName: String, totalTasks: Int, totalInstances: Int, openInstances: Int,
                                finishedInstances: Int, inProgressInstances: Int)
object ProjectProgressEntry { implicit val jsonFormat = Json.format[ProjectProgressEntry] }

class AnalysisController @Inject()(val messagesApi: MessagesApi) extends Controller with FoxImplicits {


  def projectProgressOverview(teamId: String) = SecuredAction.async { implicit request =>
    for {
      team <- TeamDAO.findOneById(teamId)(GlobalAccessContext)
      projects <- ProjectDAO.findAllByTeamName(team.name)(GlobalAccessContext)
      i <- Fox.sequence(projects.map(p => progressOfProject(p, team)(GlobalAccessContext)))
      x: List[ProjectProgressEntry] = i.flatten
    } yield {
      val k = x
      Ok(Json.toJson(x))
    }
  }

  def progressOfProject(project: Project, team: Team)(implicit ctx: DBAccessContext): Fox[ProjectProgressEntry] = {
    for {
      tasks <- TaskDAO.findAllByProject(project.name)
      totalTasks = tasks.length
      totalInstances = tasks.map(_.instances).sum
      finishedInstances <- AnnotationDAO.countFinishedByTaskIdsAndType(tasks.map(_._id), AnnotationType.Task)
      inProgressInstances <- AnnotationDAO.countUnfinishedByTaskIdsAndType(tasks.map(_._id), AnnotationType.Task)
      openInstances = totalInstances - finishedInstances - inProgressInstances
      _ <- assertNotPaused(project, finishedInstances, inProgressInstances)
      _ <- assertExpDomain(tasks.headOption, inProgressInstances, team)
      _ <- assertAge(tasks, inProgressInstances, openInstances)
    } yield {
      ProjectProgressEntry(project.name, totalTasks, totalInstances, openInstances, finishedInstances, inProgressInstances)
    }
  }

  def assertNotPaused(project: Project, finishedInstances: Int, inProgressInstances: Int) = {
    if (project.paused && finishedInstances == 0 && inProgressInstances == 0) {
      Fox.failure("assertB")
    } else Fox.successful(())
  }

  def assertExpDomain(firstTask: Option[Task], inProgressInstances: Int, team: Team)(implicit ctx: DBAccessContext) = {
    if (inProgressInstances > 0) Fox.successful(())
    else firstTask match {
      case Some(task) => assertMatchesAnyUserOfTeam(task.neededExperience, team)
      case _ => Fox.failure("assertC")
    }
  }

  def assertMatchesAnyUserOfTeam(experience: Experience, team: Team)(implicit ctx: DBAccessContext) = {
    for {
      users <- UserDAO.findByTeams(List(team.name), false)
      _ <- users.exists(user => user.experiences.contains(experience.domain) && user.experiences(experience.domain) >= experience.value)
    } yield {
      ()
    }
  }

  def assertAge(tasks: List[Task], inProgressInstances: Int, openInstances: Int)(implicit ctx: DBAccessContext) = {
    if (inProgressInstances > 0 || openInstances > 0) Fox.successful(())
    else {
      assertRecentlyModified(tasks)
    }
  }

  def assertRecentlyModified(tasks: List[Task])(implicit ctx: DBAccessContext) = {
    for {
      count <- AnnotationDAO.countRecentlyModifiedByTaskIdsAndType(tasks.map(_._id), AnnotationType.Task, System.currentTimeMillis - (30 days).toMillis)
      _ <- count > 0
    } yield {
      ()
    }
  }



  def openTasksOverview(id: String) = SecuredAction.async { implicit request =>
    for {
      team <- TeamDAO.findOneById(id)(GlobalAccessContext)
      users <- UserDAO.findByTeams(List(team.name), true)(GlobalAccessContext)
      stuff: List[OpenTasksEntry] <- getAllAvailableTaskCountsAndProjects(users)(GlobalAccessContext)
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
