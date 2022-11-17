package models.folder

import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.schema.Tables.{Folders, _}
import models.organization.{Organization, OrganizationDAO}
import models.team.{TeamDAO, TeamService}
import models.user.User
import play.api.libs.json.{JsObject, Json, OFormat}
import slick.jdbc.PostgresProfile.api._
import slick.lifted.Rep
import slick.sql.SqlAction
import utils.{ObjectId, SQLClient, SQLDAO}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

case class Folder(_id: ObjectId, name: String)

case class FolderWithParent(_id: ObjectId, name: String, _parent: Option[ObjectId])

case class FolderParameters(name: String, allowedTeams: List[ObjectId])
object FolderParameters {
  implicit val jsonFormat: OFormat[FolderParameters] = Json.format[FolderParameters]
}

class FolderService @Inject()(teamDAO: TeamDAO,
                              teamService: TeamService,
                              folderDAO: FolderDAO,
                              organizationDAO: OrganizationDAO)(implicit ec: ExecutionContext) {

  def publicWrites(
      folder: Folder,
      requestingUser: Option[User] = None,
      requestingUserOrganization: Option[Organization] = None)(implicit ctx: DBAccessContext): Fox[JsObject] =
    for {
      teams <- teamService.allowedTeamsForFolder(folder._id, cumulative = false, requestingUser)
      teamsJs <- Fox.serialCombined(teams)(t => teamService.publicWrites(t, requestingUserOrganization)) ?~> "dataset.list.teamWritesFailed"
      teamsCumulative <- teamService.allowedTeamsForFolder(folder._id, cumulative = true, requestingUser)
      teamsCumulativeJs <- Fox.serialCombined(teamsCumulative)(t =>
        teamService.publicWrites(t, requestingUserOrganization)) ?~> "dataset.list.teamWritesFailed"
      isEditable <- folderDAO.isEditable(folder._id)
    } yield
      Json.obj("id" -> folder._id,
               "name" -> folder.name,
               "allowedTeams" -> teamsJs,
               "allowedTeamsCumulative" -> teamsCumulativeJs,
               "isEditable" -> isEditable)

  def publicWritesWithParent(folderWithParent: FolderWithParent, allEditableIds: Set[ObjectId]): JsObject =
    Json.obj(
      "id" -> folderWithParent._id,
      "name" -> folderWithParent.name,
      "parent" -> folderWithParent._parent,
      "isEditable" -> allEditableIds.contains(folderWithParent._id)
    )

  def updateAllowedTeams(folderId: ObjectId, teams: List[ObjectId], requestingUser: User)(
      implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- folderDAO.findOne(folderId) ?~> "folder.notFound"
      includeMemberOnlyTeams = requestingUser.isDatasetManager
      userTeams <- if (includeMemberOnlyTeams) teamDAO.findAll else teamDAO.findAllEditable
      oldAllowedTeams: List[ObjectId] <- teamService.allowedTeamIdsForFolder(folderId, cumulative = false)
      teamsWithoutUpdate = oldAllowedTeams.filterNot(t => userTeams.exists(_._id == t))
      teamsWithUpdate = teams.filter(t => userTeams.exists(_._id == t))
      newTeamIds = (teamsWithUpdate ++ teamsWithoutUpdate).distinct
      _ <- teamDAO.updateAllowedTeamsForFolder(folderId, newTeamIds)
    } yield ()

}

class FolderDAO @Inject()(sqlClient: SQLClient)(implicit ec: ExecutionContext)
    extends SQLDAO[Folder, FoldersRow, Folders](sqlClient) {

  val collection = Folders
  def idColumn(x: Folders): Rep[String] = x._Id
  def isDeletedColumn(x: Folders): Rep[Boolean] = x.isdeleted

  def parse(r: FoldersRow): Fox[Folder] =
    Fox.successful(Folder(ObjectId(r._Id), r.name))

  def parseWithParent(t: (String, String, Option[String])): Fox[FolderWithParent] =
    Fox.successful(FolderWithParent(ObjectId(t._1), t._2, t._3.map(ObjectId(_))))

  override def readAccessQ(requestingUserId: ObjectId): String = readAccessQWithPrefix(requestingUserId, "")

  def readAccessQWithPrefix(requestingUserId: ObjectId, prefix: String): String =
    rawAccessQ(write = false, requestingUserId, prefix)

  override def updateAccessQ(requestingUserId: ObjectId): String =
    rawAccessQ(write = true, requestingUserId, prefix = "")

  private def rawAccessQ(write: Boolean, requestingUserId: ObjectId, prefix: String): String = {
    val writeAccessPredicate = if (write) "AND tr.isTeamManager" else ""
    val breadCrumbsAccessForFolder =
      if (write) ""
      else
        s"""
       -- only for read access: you may read the ancestors of a folder you can access
       UNION ALL
       SELECT fp._ancestor
       FROM webknossos.folder_paths fp
       WHERE fp._descendant IN (
         SELECT at._folder
         FROM webknossos.folder_allowedTeams at
         JOIN webknossos.user_team_roles tr ON at._team = tr._team
         WHERE tr._user = '$requestingUserId'
       )
       """
    val breadCrumbsAccessForDataset =
      if (write) ""
      else
        s"""
       -- only for read access: you may read the ancestors of a dataset you can access
       UNION ALL
       SELECT fp._ancestor
       FROM webknossos.folder_paths fp
       WHERE fp._descendant IN (
         SELECT d._folder
         FROM webknossos.dataSets_ d
         JOIN webknossos.dataSet_allowedTeams dt ON dt._dataSet = d._id
         JOIN webknossos.user_team_roles ut ON dt._team = ut._team
         WHERE ut._user = '$requestingUserId'
       )
       """
    s"""
        (
          -- is descendant of user organization folder and user is admin or dataset manager
          ${prefix}_id IN (
            SELECT fp._descendant
            FROM webknossos.folder_paths fp
            WHERE fp._ancestor IN (
               SELECT o._rootFolder
               FROM webknossos.organizations_ o
               JOIN webknossos.users_ u ON u._organization = o._id
               WHERE u._id = '$requestingUserId'
               AND (
                 u.isAdmin
                 OR u.isDatasetManager
               )
            )
          )
        )
        OR (
          -- is descendant of a folder with allowed teams the user is in
          ${prefix}_id IN (
            SELECT fp._descendant
            FROM webknossos.folder_paths fp
            WHERE fp._ancestor IN (
              SELECT at._folder
              FROM webknossos.folder_allowedTeams at
              JOIN webknossos.user_team_roles tr ON at._team = tr._team
              WHERE tr._user = '$requestingUserId'
              $writeAccessPredicate
            )
            $breadCrumbsAccessForFolder
            $breadCrumbsAccessForDataset
          )
        )
        """
  }

  def insertAsRoot(f: Folder): Fox[Unit] = {
    val insertPathQuery =
      sqlu"INSERT INTO webknossos.folder_paths(_ancestor, _descendant, depth) VALUES(${f._id}, ${f._id}, 0)"
    for {
      _ <- run(DBIO.sequence(List(insertFolderQuery(f), insertPathQuery)).transactionally)
    } yield ()
  }

  override def findOne(folderId: ObjectId)(implicit ctx: DBAccessContext): Fox[Folder] =
    for {
      accessQuery <- readAccessQuery
      rows <- run(sql"SELECT #$columns FROM webknossos.folders WHERE _id = $folderId and #$accessQuery".as[FoldersRow])
      parsed <- parseFirst(rows, "id")
    } yield parsed

  def countChildren(folderId: ObjectId): Fox[Int] =
    for {
      rows <- run(sql"SELECT COUNT(*) FROM webknossos.folder_paths WHERE _ancestor = $folderId AND depth = 1".as[Int])
      firstRow <- rows.headOption
    } yield firstRow

  def updateName(folderId: ObjectId, name: String)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(folderId)
      _ <- run(sqlu"UPDATE webknossos.folders SET name = $name WHERE _id = $folderId")
    } yield ()

  def findAllEditableIds(implicit ctx: DBAccessContext): Fox[List[ObjectId]] =
    for {
      updateAccessQuery <- accessQueryFromAccessQ(updateAccessQ)
      rows <- run(sql"SELECT _id FROM webknossos.folders_ WHERE #$updateAccessQuery".as[ObjectId])
    } yield rows.toList

  def isEditable(folderId: ObjectId)(implicit ctx: DBAccessContext): Fox[Boolean] =
    for {
      updateAccessQuery <- accessQueryFromAccessQ(updateAccessQ)
      rows <- run(sql"""SELECT EXISTS(
                SELECT 1 FROM
                webknossos.folders_
                WHERE _id = $folderId
                AND #$updateAccessQuery
              )
           """.as[Boolean])
      result <- rows.headOption
    } yield result

  def findTreeOf(folderId: ObjectId)(implicit ctx: DBAccessContext): Fox[List[FolderWithParent]] =
    for {
      accessQueryWithPrefix <- accessQueryFromAccessQWithPrefix(readAccessQWithPrefix, prefix = "f.")
      accessQuery <- readAccessQuery
      rows <- run(sql"""SELECT f._id, f.name, fp._ancestor
              FROM webknossos.folders_ f
              JOIN webknossos.folder_paths fp -- join to find immediate parent, this will also kick out self
              ON f._id = fp._descendant
              WHERE fp.depth = 1 AND f._id IN
              (SELECT _descendant  -- find all folder ids that are descendants
              FROM webknossos.folder_paths
              WHERE _ancestor = $folderId)
              AND #$accessQueryWithPrefix
              UNION ALL SELECT _id, name, NULL from webknossos.folders_  -- find self again, with no parent
              WHERE _id = $folderId
              AND #$accessQuery
              """.as[(String, String, Option[String])])
      parsed <- Fox.combined(rows.toList.map(parseWithParent))
    } yield parsed

  def insertAsChild(parentId: ObjectId, f: Folder)(implicit ctx: DBAccessContext): Fox[Unit] = {
    val insertPathQuery =
      sqlu"""INSERT INTO webknossos.folder_paths(_ancestor, _descendant, depth)
             SELECT _ancestor, ${f._id}, depth + 1 from webknossos.folder_paths WHERE _descendant = $parentId -- links to ancestors
             UNION ALL SELECT ${f._id}, ${f._id}, 0 -- self link
          """
    for {
      _ <- assertUpdateAccess(parentId)
      _ <- run(DBIO.sequence(List(insertFolderQuery(f), insertPathQuery)))
    } yield ()
  }

  def moveSubtree(idValidated: ObjectId, newParentIdValidated: ObjectId)(implicit ctx: DBAccessContext): Fox[Unit] = {
    val deleteObsoletePathsQuery =
      sqlu"""
         DELETE FROM webknossos.folder_paths
         WHERE _descendant IN (SELECT _descendant FROM webknossos.folder_paths WHERE _ancestor = $idValidated)
         AND _ancestor NOT IN (SELECT _descendant FROM webknossos.folder_paths WHERE _ancestor = $idValidated)
        """
    val insertNewPathsQuery =
      sqlu"""
        INSERT INTO webknossos.folder_paths (_ancestor, _descendant, depth)
        SELECT supertree._ancestor, subtree._descendant, supertree.depth + subtree.depth + 1
        FROM webknossos.folder_paths supertree
        CROSS JOIN webknossos.folder_paths subtree
        WHERE subtree._ancestor = $idValidated
        AND supertree._descendant = $newParentIdValidated
          """
    for {
      _ <- assertUpdateAccess(idValidated)
      _ <- assertUpdateAccess(newParentIdValidated)
      _ <- run(DBIO.sequence(List(deleteObsoletePathsQuery, insertNewPathsQuery)).transactionally)
    } yield ()
  }

  override def deleteOne(folderId: ObjectId)(implicit ctx: DBAccessContext): Fox[Unit] = {
    val deleteFolderQuery = sqlu"UPDATE webknossos.folders SET isDeleted = true WHERE _id = $folderId"
    val deletePathsQuery =
      sqlu"DELETE FROM webknossos.folder_paths WHERE _ancestor = $folderId OR _descendant = $folderId"
    for {
      _ <- assertDeleteAccess(folderId)
      _ <- run(DBIO.sequence(List(deleteFolderQuery, deletePathsQuery)).transactionally)
    } yield ()
  }

  private def insertFolderQuery(f: Folder): SqlAction[Int, NoStream, Effect] =
    sqlu"INSERT INTO webknossos.folders(_id, name) VALUES (${f._id}, ${f.name})"

}
