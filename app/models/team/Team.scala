package models.team

import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.schema.Tables._

import javax.inject.Inject
import models.annotation.AnnotationDAO
import models.binary.DataSet
import models.organization.{Organization, OrganizationDAO}
import models.project.ProjectDAO
import models.task.TaskTypeDAO
import models.user.User
import play.api.i18n.{Messages, MessagesProvider}
import play.api.libs.json._
import slick.jdbc.PostgresProfile.api._
import slick.jdbc.TransactionIsolation.Serializable
import slick.lifted.Rep
import utils.{ObjectId, SQLClient, SQLDAO}

import scala.concurrent.ExecutionContext

case class Team(
    _id: ObjectId,
    _organization: ObjectId,
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
        "organization" -> organization.name
      )
    }

  def assertNoReferences(teamId: ObjectId)(implicit mp: MessagesProvider): Fox[Unit] =
    for {
      projectCount <- projectDAO.countForTeam(teamId)
      _ <- bool2Fox(projectCount == 0) ?~> Messages("team.inUse.projects", projectCount)
      taskTypeCount <- taskTypeDAO.countForTeam(teamId)
      _ <- bool2Fox(projectCount == 0) ?~> Messages("team.inUse.taskTypes", taskTypeCount)
      annotationCount <- annotationDAO.countForTeam(teamId)
      _ <- bool2Fox(projectCount == 0) ?~> Messages("team.inUse.annotations", annotationCount)
    } yield ()

  def allowedTeamsForFolder(folderId: ObjectId, cumulative: Boolean, requestingUser: Option[User] = None)(
      implicit ctx: DBAccessContext): Fox[List[Team]] =
    for {
      teamIds <- allowedTeamIdsForFolder(folderId, cumulative)
      teams <- teamDAO.findAllByIds(teamIds)
      teamsFiltered = removeForeignOrganizationTeams(teams, requestingUser)
    } yield teamsFiltered

  def allowedTeamsForDataset(dataset: DataSet, cumulative: Boolean, requestingUser: Option[User] = None)(
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

  def allowedTeamIdsForDataset(dataset: DataSet, cumulative: Boolean): Fox[List[ObjectId]] =
    if (cumulative)
      for {
        idsForDataset <- teamDAO.findAllowedTeamIdsForDataset(dataset._id)
        idsForFolder <- teamDAO.findAllowedTeamIdsCumulativeForFolder(dataset._folder)
      } yield (idsForDataset ++ idsForFolder).distinct
    else teamDAO.findAllowedTeamIdsForDataset(dataset._id)

  private def removeForeignOrganizationTeams(teams: List[Team], requestingUser: Option[User]): List[Team] =
    teams.filter(team => requestingUser.map(_._organization).contains(team._organization))
}

class TeamDAO @Inject()(sqlClient: SQLClient)(implicit ec: ExecutionContext)
    extends SQLDAO[Team, TeamsRow, Teams](sqlClient) {
  protected val collection = Teams

  protected def idColumn(x: Teams): Rep[String] = x._Id
  protected def isDeletedColumn(x: Teams): Rep[Boolean] = x.isdeleted

  protected def parse(r: TeamsRow): Fox[Team] =
    Fox.successful(
      Team(
        ObjectId(r._Id),
        ObjectId(r._Organization),
        r.name,
        r.isorganizationteam,
        Instant.fromSql(r.created),
        r.isdeleted
      ))

  override protected def readAccessQ(requestingUserId: ObjectId) =
    s"""(_id in (select _team from webknossos.user_team_roles where _user = '$requestingUserId')
       or _organization in (select _organization from webknossos.users_ where _id = '$requestingUserId' and isAdmin))"""

  override protected def deleteAccessQ(requestingUserId: ObjectId) =
    s"""(not isorganizationteam
          and _organization in (select _organization from webknossos.users_ where _id = '$requestingUserId' and isAdmin))"""

  override def findOne(id: ObjectId)(implicit ctx: DBAccessContext): Fox[Team] =
    for {
      accessQuery <- readAccessQuery
      r <- run(sql"select #$columns from #$existingCollectionName where _id = $id and #$accessQuery".as[TeamsRow])
      parsed <- parseFirst(r, id)
    } yield parsed

  def countByNameAndOrganization(teamName: String, organizationId: ObjectId): Fox[Int] =
    for {
      countList <- run(
        sql"select count(_id) from #$existingCollectionName where name = $teamName and _organization = $organizationId"
          .as[Int])
      count <- countList.headOption
    } yield count

  override def findAll(implicit ctx: DBAccessContext): Fox[List[Team]] =
    for {
      accessQuery <- readAccessQuery
      r <- run(sql"select #$columns from #$existingCollectionName where #$accessQuery".as[TeamsRow])
      parsed <- parseAll(r)
    } yield parsed

  def findAllEditable(implicit ctx: DBAccessContext): Fox[List[Team]] =
    for {
      requestingUserId <- userIdFromCtx
      accessQuery <- readAccessQuery
      r <- run(sql"""select #$columns from #$existingCollectionName
                     where (_id in (select _team from webknossos.user_team_roles where _user = $requestingUserId and isTeamManager)
                           or _organization in (select _organization from webknossos.users_ where _id = $requestingUserId and isAdmin))
                     and #$accessQuery""".as[TeamsRow])
      parsed <- parseAll(r)
    } yield parsed

  def findAllIdsByOrganization(organizationId: ObjectId)(implicit ctx: DBAccessContext): Fox[List[ObjectId]] =
    for {
      accessQuery <- readAccessQuery
      r <- run(
        sql"select _id from #$existingCollectionName where _organization = $organizationId and #$accessQuery"
          .as[String])
      parsed <- Fox.serialCombined(r.toList)(col => ObjectId.fromString(col))
    } yield parsed

  def findAllByIds(teamIds: List[ObjectId])(implicit ctx: DBAccessContext): Fox[List[Team]] =
    for {
      accessQuery <- readAccessQuery
      idsLiteral = writeStructTupleWithQuotes(teamIds.map(t => sanitize(t.id)))
      idPredicate = if (teamIds.isEmpty) "false" else s"_id IN $idsLiteral"
      r <- run(sql"SELECT #$columns FROM #$existingCollectionName WHERE #$idPredicate AND #$accessQuery".as[TeamsRow])
      parsed <- parseAll(r)
    } yield parsed

  def findSharedTeamsForAnnotation(annotationId: ObjectId)(implicit ctx: DBAccessContext): Fox[List[Team]] =
    for {
      accessQuery <- readAccessQuery
      r <- run(sql"""SELECT #$columns from #$existingCollectionName
              WHERE _id IN (SELECT _team FROM webknossos.annotation_sharedTeams WHERE _annotation = $annotationId)
              AND #$accessQuery""".as[TeamsRow])
      parsed <- parseAll(r)
    } yield parsed

  def insertOne(t: Team): Fox[Unit] =
    for {
      _ <- run(sqlu"""INSERT INTO webknossos.teams(_id, _organization, name, created, isOrganizationTeam, isDeleted)
                  VALUES(${t._id}, ${t._organization}, ${t.name}, ${t.created}, ${t.isOrganizationTeam}, ${t.isDeleted})
            """)
    } yield ()

  // Allowed Teams for Datasets and Folders

  def findAllowedTeamIdsForFolder(folderId: ObjectId): Fox[List[ObjectId]] =
    for {
      rows <- run(sql"SELECT _team FROM webknossos.folder_allowedTeams WHERE _folder = $folderId".as[ObjectId])
    } yield rows.toList

  def findAllowedTeamIdsForDataset(datasetId: ObjectId): Fox[List[ObjectId]] =
    for {
      rows <- run(sql"SELECT _team FROM webknossos.dataset_allowedTeams WHERE _dataset = $datasetId".as[ObjectId])
    } yield rows.toList

  // Allowed teams are additive down through the folder paths
  def findAllowedTeamIdsCumulativeForFolder(folderId: ObjectId): Fox[List[ObjectId]] =
    for {
      rows <- run(sql"""
          SELECT DISTINCT at._team
          FROM webknossos.folder_allowedteams at
          JOIN webknossos.folder_paths fp ON at._folder = fp._ancestor
          WHERE fp._descendant = $folderId""".as[ObjectId])
    } yield rows.toList

  def updateAllowedTeamsForDataset(datasetId: ObjectId, allowedTeams: List[ObjectId]): Fox[Unit] = {
    val clearQuery = sqlu"DELETE FROM webknossos.dataSet_allowedTeams WHERE _dataSet = $datasetId"
    val insertQueries = allowedTeams.map(teamId => sqlu"""INSERT INTO webknossos.dataSet_allowedTeams(_dataSet, _team)
             VALUES($datasetId, $teamId)""")

    val composedQuery = DBIO.sequence(List(clearQuery) ++ insertQueries)
    for {
      _ <- run(composedQuery.transactionally.withTransactionIsolation(Serializable),
               retryCount = 50,
               retryIfErrorContains = List(transactionSerializationError))
    } yield ()
  }

  def updateAllowedTeamsForFolder(folderId: ObjectId, allowedTeams: List[ObjectId]): Fox[Unit] = {
    val clearQuery = sqlu"DELETE FROM webknossos.folder_allowedTeams WHERE _folder = $folderId"
    val insertQueries = allowedTeams.map(teamId => sqlu"""INSERT INTO webknossos.folder_allowedTeams(_folder, _team)
             VALUES($folderId, $teamId)""")

    val composedQuery = DBIO.sequence(List(clearQuery) ++ insertQueries)
    for {
      _ <- run(composedQuery.transactionally.withTransactionIsolation(Serializable),
               retryCount = 50,
               retryIfErrorContains = List(transactionSerializationError))
    } yield ()
  }

  def removeTeamFromAllDatasetsAndFolders(teamId: ObjectId): Fox[Unit] =
    for {
      _ <- run(sqlu"DELETE FROM webknossos.dataSet_allowedTeams WHERE _team = $teamId")
      _ <- run(sqlu"DELETE FROM webknossos.folder_allowedTeams WHERE _team = $teamId")
    } yield ()

}
