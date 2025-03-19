package controllers

import play.silhouette.api.Silhouette
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.annotation.{AnnotationDAO, AnnotationType}
import models.team.TeamDAO
import models.user.{User, UserDAO, UserService}
import play.api.libs.json.{Json, OFormat}
import play.api.mvc.{Action, AnyContent}
import security.WkEnv
import com.scalableminds.util.objectid.ObjectId
import utils.sql.{SimpleSQLDAO, SqlClient}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

case class AvailableTaskCountsEntry(id: String,
                                    user: String,
                                    totalAvailableTasks: Int,
                                    availableTasksByProjects: Map[String, Int])
object AvailableTaskCountsEntry {
  implicit val jsonFormat: OFormat[AvailableTaskCountsEntry] = Json.format[AvailableTaskCountsEntry]
}

case class ProjectProgressEntry(projectName: String,
                                paused: Boolean,
                                priority: Long,
                                totalTasks: Int,
                                totalInstances: Int,
                                pendingInstances: Int,
                                finishedInstances: Int,
                                activeInstances: Int,
                                billedMilliseconds: Long)
object ProjectProgressEntry {
  implicit val jsonFormat: OFormat[ProjectProgressEntry] = Json.format[ProjectProgressEntry]
}

class ReportDAO @Inject()(sqlClient: SqlClient, annotationDAO: AnnotationDAO)(implicit ec: ExecutionContext)
    extends SimpleSQLDAO(sqlClient) {

  def projectProgress(teamId: ObjectId): Fox[List[ProjectProgressEntry]] =
    for {
      r <- run(q"""
          WITH teamMembers AS (
            SELECT _user FROM webknossos.user_team_roles ut WHERE ut._team = $teamId
          )

          ,experiences AS (
            SELECT ue.domain, ue.value
            FROM teamMembers u
            JOIN webknossos.user_experiences ue ON ue._user = u._user
          )

          ,filteredProjects AS (
            SELECT p._id, p.name, p.paused, p.priority
            FROM webknossos.projects_ p
            JOIN webknossos.tasks_ t ON t._project = p._id
            CROSS JOIN experiences ue
            WHERE p._team = $teamId
              AND t.neededExperience_domain = ue.domain
              AND t.neededExperience_value <= ue.value
              AND NOT p.isblacklistedfromreport
            GROUP BY p._id, p.name, p.paused, p.priority
          )

          ,projectModifiedTimes AS (
            SELECT p._id, MAX(a.modified) AS modified
            FROM filteredProjects p
            JOIN webknossos.tasks_ t ON t._project = p._id
            LEFT JOIN webknossos.annotations_ a ON t._id = a._task
            GROUP BY p._id
          )

          ,s1 AS (
            SELECT
              p._id,
              p.name projectName,
              p.paused paused,
              p.priority priority,
              COUNT(t._id) totalTasks,
              SUM(t.totalInstances) totalInstances,
              SUM(t.pendingInstances) pendingInstances,
              SUM(t.tracingTime) tracingTime
            FROM filteredProjects p
            JOIN webknossos.tasks_ t ON p._id = t._project
            GROUP BY p._id, p.name, p.paused, p.priority
          )

          ,s2 AS (
            SELECT p._id, COUNT(a) activeInstances
            FROM filteredProjects p
            JOIN webknossos.tasks_ t ON p._id = t._project
            LEFT JOIN (
              SElECT ${annotationDAO.columns}
              FROM webknossos.annotations_ a
              WHERE a.state = 'Active'
              AND a.typ = 'Task'
            ) a ON t._id = a._task
            GROUP BY p._id
          )

          SELECT
            s1.projectName,
            s1.paused,
            s1.priority,
            s1.totalTasks,
            s1.totalInstances,
            s1.pendingInstances,
            (s1.totalInstances - s1.pendingInstances - s2.activeInstances) finishedInstances,
            s2.activeInstances,
            s1.tracingTime
          FROM s1
          JOIN s2 ON s1._id = s2._id
          JOIN projectModifiedTimes pmt ON s1._id = pmt._id
          WHERE (
            NOT (
              s1.paused AND s1.totalInstances = s1.pendingInstances
            )
          )
          AND (
            (s1.pendingInstances > 0 AND NOT s1.paused)
            OR s2.activeInstances > 0
            OR pmt.modified > NOW() - INTERVAL '30 days'
          )
        """.as[(String, Boolean, Long, Int, Int, Int, Int, Int, Long)])
    } yield {
      r.toList.map(row => ProjectProgressEntry(row._1, row._2, row._3, row._4, row._5, row._6, row._7, row._8, row._9))
    }

  def getAvailableTaskCountsByProjectsFor(userId: ObjectId): Fox[Map[String, Int]] =
    for {
      r <- run(q"""
        SELECT p._id, p.name, t.neededExperience_domain, t.neededExperience_value, COUNT(t._id)
        FROM webknossos.tasks_ t
        JOIN (
          SELECT domain, value
          FROM webknossos.user_experiences
          WHERE _user = $userId
        ) AS ue ON t.neededExperience_domain = ue.domain AND t.neededExperience_value <= ue.value
        JOIN webknossos.projects_ p ON t._project = p._id
        LEFT JOIN (
          SELECT _task
          FROM webknossos.annotations_
          WHERE _user = $userId
          AND typ = ${AnnotationType.Task}
        ) AS userAnnotations ON t._id = userAnnotations._task
        WHERE t.pendingInstances > 0
        AND userAnnotations._task IS NULL
        AND NOT p.paused
        GROUP BY p._id, p.name, t.neededExperience_domain, t.neededExperience_value
      """.as[(String, String, String, Int, Int)])
    } yield {
      val formattedList = r.toList.map(row => (row._2 + "/" + row._3 + ": " + row._4, row._5))
      formattedList.toMap.filter(_ match { case (_: String, availableTasksCount: Int) => availableTasksCount > 0 })
    }

}

class ReportController @Inject()(reportDAO: ReportDAO,
                                 teamDAO: TeamDAO,
                                 userDAO: UserDAO,
                                 userService: UserService,
                                 sil: Silhouette[WkEnv])(implicit ec: ExecutionContext)
    extends Controller
    with FoxImplicits {

  def projectProgressReport(teamId: ObjectId): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      _ <- teamDAO.findOne(teamId) ?~> "team.notFound" ~> NOT_FOUND
      entries <- reportDAO.projectProgress(teamId)
    } yield Ok(Json.toJson(entries))
  }

  def availableTasksReport(teamId: ObjectId): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      team <- teamDAO.findOne(teamId) ?~> "team.notFound" ~> NOT_FOUND
      users <- userDAO.findAllByTeams(List(team._id))
      nonUnlistedUsers = users.filter(!_.isUnlisted)
      nonAdminUsers <- Fox.filterNot(nonUnlistedUsers)(u => userService.isTeamManagerOrAdminOf(u, teamId))
      entries: List[AvailableTaskCountsEntry] <- getAvailableTaskCountsAndProjects(nonAdminUsers)
    } yield Ok(Json.toJson(entries))
  }

  private def getAvailableTaskCountsAndProjects(users: Seq[User]): Fox[List[AvailableTaskCountsEntry]] = {
    val foxes = users.map { user =>
      for {
        pendingTaskCountsByProjects <- reportDAO.getAvailableTaskCountsByProjectsFor(user._id)
      } yield {
        AvailableTaskCountsEntry(user._id.toString,
                                 user.name,
                                 pendingTaskCountsByProjects.values.sum,
                                 pendingTaskCountsByProjects)
      }
    }
    Fox.combined(foxes.toList)
  }

}
