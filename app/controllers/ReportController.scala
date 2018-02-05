/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package controllers

import javax.inject.Inject

import com.scalableminds.util.reactivemongo.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.annotation.{AnnotationDAO, AnnotationType}
import models.task._
import models.team.TeamDAO
import models.user.{User, UserDAO}
import oxalis.security.WebknossosSilhouette.SecuredAction
import play.api.i18n.MessagesApi
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.Json
import slick.jdbc.PostgresProfile.api._
import utils.{ObjectId, SimpleSQLDAO}


case class OpenTasksEntry(id: String, user: String, totalAssignments: Int, assignmentsByProjects: Map[String, Int])
object OpenTasksEntry { implicit val jsonFormat = Json.format[OpenTasksEntry] }

case class ProjectProgressEntry(projectName: String, paused: Boolean, totalTasks: Int, totalInstances: Int, openInstances: Int,
                                finishedInstances: Int, activeInstances: Int)
object ProjectProgressEntry { implicit val jsonFormat = Json.format[ProjectProgressEntry] }

object ReportSQLDAO extends SimpleSQLDAO {

  def projectProgress(teamId: ObjectId)(implicit ctx: DBAccessContext): Fox[List[ProjectProgressEntry]] = {
    for {
      r <- run(
        sql"""
          with filteredProjects as (select p._id, p.name, p.paused
          from
            webknossos.projects p
            JOIN webknossos.tasks t ON t._project = p._id
            JOIN webknossos.annotations a ON a._task = t._id
            JOIN webknossos.users u ON u._id = a._user
            JOIN webknossos.user_team_roles ut ON ut._user = u._id
            JOIN webknossos.user_experiences ue ON ue._user = u._id
          where p._team = '5a74584e9700009400744f94' and
          t.neededExperience_domain = ue.domain and
          t.neededExperience_value <= ue.value and
          a.modified > NOW() - INTERVAL '30 days'
          group by p._id)

          ,s1 as (select
               p._id,
               p.name projectName,
               p.paused paused,
               count(t._id) totalTasks,
               sum(t.totalInstances) totalInstances,
               sum(ti.openInstances) openInstances
          from
            filteredProjects p
            join webknossos.tasks t on p._id = t._project
            join webknossos.task_instances ti on t._id = ti._id
          group by p._id, p.name, p.paused)

          ,s2 as (select p._id,
             count(a) activeInstances
           FROM
             filteredProjects p
             join webknossos.tasks t on p._id = t._project
             left join (select * from webknossos.annotations a where a.state = 'Active' and a.typ = 'Task') a on t._id = a._task
           group by p._id
           )


          select s1.projectName, s1.paused, s1.totalTasks, s1.totalInstances, s1.openInstances, (s1.totalInstances - s1.openInstances - s2.activeInstances) finishedInstances, s2.activeInstances from s1 join s2 on s1._id = s2._id
          where not (paused and s1.totalInstances = s1.openInstances)
        """.as[(String, Boolean, Int, Int, Int, Int, Int)])
    } yield {
      r.toList.map(row => ProjectProgressEntry(row._1, row._2, row._3, row._4, row._5, row._6, row._7))
    }
  }
}

class ReportController @Inject()(val messagesApi: MessagesApi) extends Controller with FoxImplicits {

  def projectProgressOverview(teamId: String) = SecuredAction.async { implicit request =>
    for {
      entries <- ReportSQLDAO.projectProgress(ObjectId(teamId))(GlobalAccessContext)
    } yield Ok(Json.toJson(entries))
  }

  /**
    * assumes that all tasks of a project have the same required experience
    */
  def openTasksOverview(id: String) = SecuredAction.async { implicit request =>
    for {
      team <- TeamDAO.findOneById(id)(GlobalAccessContext)
      users <- UserDAO.findByTeams(List(team.name), includeInactive = false)(GlobalAccessContext)
      nonAdminUsers = users.filterNot(_.isAdminOf(team.name))
      entries: List[OpenTasksEntry] <- getAllAvailableTaskCountsAndProjects(nonAdminUsers)(GlobalAccessContext)
    } yield {
      Ok(Json.toJson(entries))
    }
  }


  private def getAllAvailableTaskCountsAndProjects(users: Seq[User])(implicit ctx: DBAccessContext): Fox[List[OpenTasksEntry]] = {
    val foxes = users.map { user =>
      for {
        projects <- TaskDAO.findWithOpenByUserReturnOnlyProject(user).toFox
        assignmentCountsByProject <- getAssignmentsByProjectsFor(projects, user)
      } yield {
        OpenTasksEntry(user.id, user.name, assignmentCountsByProject.values.sum, assignmentCountsByProject)
      }
    }
    Fox.combined(foxes.toList)
  }

  private def getAssignmentsByProjectsFor(projects: Seq[String], user: User)(implicit ctx: DBAccessContext): Fox[Map[String, Int]] = {
    val projectsGrouped = projects.groupBy(identity).mapValues(_.size)
    val foxes: Iterable[Fox[(String, Int)]] = projectsGrouped.keys.map {
      project =>
        Fox(for {
          tasksIds <- TaskDAO.findAllByProjectReturnOnlyIds(project)
          doneTasks <- AnnotationDAO.countFinishedByTaskIdsAndUserIdAndType(tasksIds, user._id, AnnotationType.Task)
          firstTask <- TaskDAO.findOneByProject(project)
        } yield {
          (project + "/" + firstTask.neededExperience.toString, projectsGrouped(project) - doneTasks)
        })
    }
    for {
      list <- Fox.combined(foxes.toList)
    } yield {
      list.toMap.filter(_ match { case (title: String, openTaskCount: Int) => openTaskCount > 0 })
    }
  }

}
