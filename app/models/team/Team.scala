package models.team

import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.schema.Tables._

import javax.inject.Inject
import models.annotation.AnnotationDAO
import models.dataset.Dataset
import models.organization.{Organization, OrganizationDAO}
import models.project.ProjectDAO
import models.task.TaskTypeDAO
import models.user.User
import play.api.i18n.{Messages, MessagesProvider}
import play.api.libs.json._
import slick.lifted.Rep
import utils.sql.{SQLDAO, SqlClient, SqlToken}
import com.scalableminds.util.objectid.ObjectId

import scala.concurrent.ExecutionContext

case class Team(
    _id: ObjectId,
    _organization: String,
    name: String,
    isOrganizationTeam: Boolean = false,
    created: Instant = Instant.now,
    isDeleted: Boolean = false
) extends FoxImplicits {

  def couldBeAdministratedBy(user: User): Boolean =
    user._organization == this._organization

}

class TeamService @Inject()(organizationDAO: OrganizationDAO,
                            annotationDAO: AnnotationDAO,
                            teamDAO: TeamDAO,
                            projectDAO: ProjectDAO,
                            taskTypeDAO: TaskTypeDAO)(implicit ec: ExecutionContext)
    extends FoxImplicits {

  def publicWrites(team: Team, organizationOpt: Option[Organization] = None): Fox[JsObject] =
    for {
      organization <- Fox.fillOption(organizationOpt)(organizationDAO.findOne(team._organization)(GlobalAccessContext))
    } yield {
      Json.obj(
        "id" -> team._id.toString,
        "name" -> team.name,
        "organization" -> organization._id
      )
    }

  def assertNoReferences(teamId: ObjectId)(implicit mp: MessagesProvider): Fox[Unit] =
    for {
      projectCount <- projectDAO.countForTeam(teamId)
      _ <- bool2Fox(projectCount == 0) ?~> Messages("team.inUse.projects", projectCount)
      taskTypeCount <- taskTypeDAO.countForTeam(teamId)
      _ <- bool2Fox(taskTypeCount == 0) ?~> Messages("team.inUse.taskTypes", taskTypeCount)
      annotationCount <- annotationDAO.countForTeam(teamId)
      _ <- bool2Fox(annotationCount == 0) ?~> Messages("team.inUse.annotations", annotationCount)
    } yield ()

  def allowedTeamsForFolder(folderId: ObjectId, cumulative: Boolean, requestingUser: Option[User] = None)(
      implicit ctx: DBAccessContext): Fox[List[Team]] =
    for {
      teamIds <- allowedTeamIdsForFolder(folderId, cumulative)
      teams <- teamDAO.findAllByIds(teamIds)
      teamsFiltered = removeForeignOrganizationTeams(teams, requestingUser)
    } yield teamsFiltered

  def allowedTeamsForDataset(dataset: Dataset, cumulative: Boolean, requestingUser: Option[User] = None)(
      implicit ctx: DBAccessContext): Fox[List[Team]] =
    for {
      teamIds <- allowedTeamIdsForDataset(dataset, cumulative)
      teams <- teamDAO.findAllByIds(teamIds)
      teamsFiltered = removeForeignOrganizationTeams(teams, requestingUser)
    } yield teamsFiltered

  def allowedTeamIdsForFolder(folderId: ObjectId, cumulative: Boolean): Fox[List[ObjectId]] =
    if (cumulative)
      teamDAO.findAllowedTeamIdsCumulativeForFolder(folderId)
    else teamDAO.findAllowedTeamIdsForFolder(folderId)

  def allowedTeamIdsForDataset(dataset: Dataset, cumulative: Boolean): Fox[List[ObjectId]] =
    if (cumulative)
      for {
        idsForDataset <- teamDAO.findAllowedTeamIdsForDataset(dataset._id)
        idsForFolder <- teamDAO.findAllowedTeamIdsCumulativeForFolder(dataset._folder)
      } yield (idsForDataset ++ idsForFolder).distinct
    else teamDAO.findAllowedTeamIdsForDataset(dataset._id)

  private def removeForeignOrganizationTeams(teams: List[Team], requestingUser: Option[User]): List[Team] =
    teams.filter(team => requestingUser.map(_._organization).contains(team._organization))
}

class TeamDAO @Inject()(sqlClient: SqlClient)(implicit ec: ExecutionContext)
    extends SQLDAO[Team, TeamsRow, Teams](sqlClient) {
  protected val collection = Teams

  protected def idColumn(x: Teams): Rep[String] = x._Id
  protected def isDeletedColumn(x: Teams): Rep[Boolean] = x.isdeleted

  protected def parse(r: TeamsRow): Fox[Team] =
    Fox.successful(
      Team(
        ObjectId(r._Id),
        r._Organization,
        r.name,
        r.isorganizationteam,
        Instant.fromSql(r.created),
        r.isdeleted
      ))

  override protected def readAccessQ(requestingUserId: ObjectId) =
    q"""_id IN (SELECT _team FROM webknossos.user_team_roles WHERE _user = $requestingUserId)
        OR _organization IN (SELECT _organization FROM webknossos.users_ WHERE _id = $requestingUserId AND isAdmin)"""

  override protected def deleteAccessQ(requestingUserId: ObjectId) =
    q"""NOT isOrganizationTeam
        AND _organization IN (SELECT _organization FROM webknossos.users_ WHERE _id = $requestingUserId AND isAdmin)"""

  override def findOne(id: ObjectId)(implicit ctx: DBAccessContext): Fox[Team] =
    for {
      accessQuery <- readAccessQuery
      r <- run(q"SELECT $columns FROM $existingCollectionName WHERE _id = $id AND $accessQuery".as[TeamsRow])
      parsed <- parseFirst(r, id)
    } yield parsed

  def countByNameAndOrganization(teamName: String, organizationId: String): Fox[Int] =
    for {
      countList <- run(
        q"SELECT COUNT(*) FROM webknossos.teams WHERE name = $teamName AND _organization = $organizationId".as[Int])
      count <- countList.headOption
    } yield count

  override def findAll(implicit ctx: DBAccessContext): Fox[List[Team]] =
    for {
      accessQuery <- readAccessQuery
      r <- run(q"SELECT $columns FROM $existingCollectionName WHERE $accessQuery".as[TeamsRow])
      parsed <- parseAll(r)
    } yield parsed

  def findAllEditable(implicit ctx: DBAccessContext): Fox[List[Team]] =
    for {
      requestingUserId <- userIdFromCtx
      accessQuery <- readAccessQuery
      r <- run(q"""SELECT $columns FROM $existingCollectionName
                   WHERE (
                     _id IN (
                       SELECT _team
                       FROM webknossos.user_team_roles
                       WHERE _user = $requestingUserId
                       AND isTeamManager
                     )
                     OR _organization IN (
                       SELECT _organization
                       FROM webknossos.users_
                       WHERE _id = $requestingUserId
                       AND isAdmin
                     )
                   )
                   AND $accessQuery""".as[TeamsRow])
      parsed <- parseAll(r)
    } yield parsed

  def findAllIdsByOrganization(organizationId: String)(implicit ctx: DBAccessContext): Fox[List[ObjectId]] =
    for {
      accessQuery <- readAccessQuery
      r <- run(
        q"SELECT _id FROM $existingCollectionName WHERE _organization = $organizationId AND $accessQuery".as[String])
      parsed <- Fox.serialCombined(r.toList)(col => ObjectId.fromString(col))
    } yield parsed

  def findAllByIds(teamIds: List[ObjectId])(implicit ctx: DBAccessContext): Fox[List[Team]] =
    for {
      accessQuery <- readAccessQuery
      idPredicate = if (teamIds.isEmpty) q"FALSE" else q"_id IN ${SqlToken.tupleFromList(teamIds)}"
      r <- run(q"""SELECT $columns FROM $existingCollectionName
                   WHERE $idPredicate AND $accessQuery""".as[TeamsRow])
      parsed <- parseAll(r)
    } yield parsed

  def findSharedTeamsForAnnotation(annotationId: ObjectId)(implicit ctx: DBAccessContext): Fox[List[Team]] =
    for {
      accessQuery <- readAccessQuery
      r <- run(q"""SELECT $columns FROM $existingCollectionName
                   WHERE _id IN (
                     SELECT _team FROM webknossos.annotation_sharedTeams WHERE _annotation = $annotationId
                   )
                   AND $accessQuery""".as[TeamsRow])
      parsed <- parseAll(r)
    } yield parsed

  def insertOne(t: Team): Fox[Unit] =
    for {
      _ <- run(q"""INSERT INTO webknossos.teams(_id, _organization, name, created, isOrganizationTeam, isDeleted)
                   VALUES(${t._id}, ${t._organization}, ${t.name}, ${t.created}, ${t.isOrganizationTeam}, ${t.isDeleted})
            """.asUpdate)
    } yield ()

  // Allowed Teams for Datasets and Folders

  def findAllowedTeamIdsForFolder(folderId: ObjectId): Fox[List[ObjectId]] =
    for {
      rows <- run(q"SELECT _team FROM webknossos.folder_allowedTeams WHERE _folder = $folderId".as[ObjectId])
    } yield rows.toList

  def findAllowedTeamIdsForDataset(datasetId: ObjectId): Fox[List[ObjectId]] =
    for {
      rows <- run(q"SELECT _team FROM webknossos.dataset_allowedTeams WHERE _dataset = $datasetId".as[ObjectId])
    } yield rows.toList

  // Allowed teams are additive down through the folder paths
  def findAllowedTeamIdsCumulativeForFolder(folderId: ObjectId): Fox[List[ObjectId]] =
    for {
      rows <- run(q"""
          SELECT DISTINCT at._team
          FROM webknossos.folder_allowedteams at
          JOIN webknossos.folder_paths fp ON at._folder = fp._ancestor
          WHERE fp._descendant = $folderId""".as[ObjectId])
    } yield rows.toList

  def updateAllowedTeamsForDataset(datasetId: ObjectId, allowedTeams: List[ObjectId]): Fox[Unit] = {
    val clearQuery = q"DELETE FROM webknossos.dataset_allowedTeams WHERE _dataset = $datasetId".asUpdate
    val insertQueries = allowedTeams.map(teamId => q"""INSERT INTO webknossos.dataset_allowedTeams(_dataset, _team)
             VALUES($datasetId, $teamId)""".asUpdate)

    replaceSequentiallyAsTransaction(clearQuery, insertQueries)
  }

  def updateAllowedTeamsForFolder(folderId: ObjectId, allowedTeams: List[ObjectId]): Fox[Unit] = {
    val clearQuery = q"DELETE FROM webknossos.folder_allowedTeams WHERE _folder = $folderId".asUpdate
    val insertQueries = allowedTeams.map(teamId => q"""INSERT INTO webknossos.folder_allowedTeams(_folder, _team)
             VALUES($folderId, $teamId)""".asUpdate)

    replaceSequentiallyAsTransaction(clearQuery, insertQueries)
  }

  def removeTeamFromAllDatasetsAndFolders(teamId: ObjectId): Fox[Unit] =
    for {
      _ <- run(q"DELETE FROM webknossos.dataset_allowedTeams WHERE _team = $teamId".asUpdate)
      _ <- run(q"DELETE FROM webknossos.folder_allowedTeams WHERE _team = $teamId".asUpdate)
    } yield ()

  override def deleteOne(teamId: ObjectId)(implicit ctx: DBAccessContext): Fox[Unit] =
    deleteOneWithNameSuffix(teamId)

}
