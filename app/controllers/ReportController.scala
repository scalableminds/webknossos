/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package controllers

import javax.inject.Inject

import com.scalableminds.util.reactivemongo.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.annotation.{AnnotationSQLDAO, AnnotationTypeSQL}
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
          with teamMembers as (select _user from webknossos.user_team_roles ut where ut._team = ${teamId.id})

          ,experiences as (select ue.domain, ue.value
          from
            teamMembers u
            JOIN webknossos.user_experiences ue on ue._user = u._user
          )

          ,filteredProjects as (select p._id, p.name, p.paused
          from
            webknossos.projects_ p
            JOIN webknossos.tasks_ t ON t._project = p._id
            CROSS JOIN experiences ue
          where p._team = ${teamId.id} and
          t.neededExperience_domain = ue.domain and
          t.neededExperience_value <= ue.value
          group by p._id, p.name, p.paused)

          ,projectModifiedTimes as (select p._id, MAX(a.modified) as modified
          from
            filteredProjects p
            JOIN webknossos.tasks_ t ON t._project = p._id
            LEFT JOIN webknossos.annotations_ a ON t._id = a._task
            group by p._id
          )

          ,s1 as (select
               p._id,
               p.name projectName,
               p.paused paused,
               count(t._id) totalTasks,
               sum(t.totalInstances) totalInstances,
               sum(t.openInstances) openInstances
          from
            filteredProjects p
            join webknossos.tasks_ t on p._id = t._project
          group by p._id, p.name, p.paused)

          ,s2 as (select p._id,
             count(a) activeInstances
           FROM
             filteredProjects p
             join webknossos.tasks_ t on p._id = t._project
             left join (select #${AnnotationSQLDAO.columns} from webknossos.annotations_ a where a.state = 'Active' and a.typ = 'Task') a on t._id = a._task
           group by p._id
           )


          select s1.projectName, s1.paused, s1.totalTasks, s1.totalInstances, s1.openInstances, (s1.totalInstances - s1.openInstances - s2.activeInstances) finishedInstances, s2.activeInstances
          from s1
            join s2 on s1._id = s2._id
            join projectModifiedTimes pmt on s1._id = pmt._id
          where (not (s1.paused and s1.totalInstances = s1.openInstances)) and ((s1.openInstances > 0 and not s1.paused) or s2.activeInstances > 0 or pmt.modified > NOW() - INTERVAL '30 days')
        """.as[(String, Boolean, Int, Int, Int, Int, Int)])
    } yield {
      r.toList.map(row => ProjectProgressEntry(row._1, row._2, row._3, row._4, row._5, row._6, row._7))
    }
  }


  def getAssignmentsByProjectsFor(userId: ObjectId)(implicit ctx: DBAccessContext): Fox[Map[String, Int]] = {
    for {
      r <- run(sql"""
        select p._id, p.name, t.neededExperience_domain, t.neededExperience_value, count(t._id)
        from
        webknossos.tasks_ t
        join
        (select domain, value
          from webknossos.user_experiences
        where _user = ${userId.id})
        as ue on t.neededExperience_domain = ue.domain and t.neededExperience_value <= ue.value
        join webknossos.projects_ p on t._project = p._id
        left join (select _task from webknossos.annotations_ where _user = ${userId.id} and typ = '#${AnnotationTypeSQL.Task}') as userAnnotations ON t._id = userAnnotations._task
        where t.openInstances > 0
        and userAnnotations._task is null
        and not p.paused
        group by p._id, p.name, t.neededExperience_domain, t.neededExperience_value
      """.as[(String, String, String, Int, Int)])
    } yield {
      val formattedList = r.toList.map(row => (row._2 + "/" + row._3 + ": " + row._4, row._5))
      formattedList.toMap.filter(_ match { case (title: String, openTaskCount: Int) => openTaskCount > 0 })
    }
  }

}

class ReportController @Inject()(val messagesApi: MessagesApi) extends Controller with FoxImplicits {

  def projectProgressOverview(teamId: String) = SecuredAction.async { implicit request =>
    for {
      entries <- ReportSQLDAO.projectProgress(ObjectId(teamId))(GlobalAccessContext)
    } yield Ok(Json.toJson(entries))
  }

  def openTasksOverview(id: String) = SecuredAction.async { implicit request =>
    for {
      team <- TeamDAO.findOneById(id)(GlobalAccessContext)
      users <- UserDAO.findByTeams(List(team._id), includeInactive = false)(GlobalAccessContext)
      nonAdminUsers <- Fox.filterNot(users)(_.isTeamManagerOrAdminOf(team._id))
      entries: List[OpenTasksEntry] <- getAllAvailableTaskCountsAndProjects(nonAdminUsers)(GlobalAccessContext)
    } yield Ok(Json.toJson(entries))
  }

  private def getAllAvailableTaskCountsAndProjects(users: Seq[User])(implicit ctx: DBAccessContext): Fox[List[OpenTasksEntry]] = {
    val foxes = users.map { user =>
      for {
        assignmentCountsByProject <- ReportSQLDAO.getAssignmentsByProjectsFor(ObjectId(user.id))
      } yield {
        OpenTasksEntry(user.id, user.name, assignmentCountsByProject.values.sum, assignmentCountsByProject)
      }
    }
    Fox.combined(foxes.toList)
  }


}
