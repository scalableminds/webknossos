package models.folder

import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.tools.{Fox, JsonHelper}
import com.scalableminds.util.tools.Fox.{fromBool, option2Fox}
import com.scalableminds.webknossos.schema.Tables._
import com.typesafe.scalalogging.LazyLogging
import models.organization.{Organization, OrganizationDAO}
import models.team.{TeamDAO, TeamService}
import models.user.User
import play.api.libs.json.{JsArray, JsObject, Json, OFormat}
import slick.jdbc.PostgresProfile.api._
import slick.lifted.Rep
import slick.sql.SqlAction
import utils.sql.{SQLDAO, SqlClient, SqlToken}
import com.scalableminds.util.objectid.ObjectId

import javax.inject.Inject
import scala.annotation.tailrec
import scala.concurrent.ExecutionContext

case class Folder(_id: ObjectId, name: String, metadata: JsArray)

case class FolderWithParent(_id: ObjectId, name: String, metadata: JsArray, _parent: Option[ObjectId])

case class FolderParameters(name: String, allowedTeams: List[ObjectId], metadata: JsArray)
object FolderParameters {
  implicit val jsonFormat: OFormat[FolderParameters] = Json.format[FolderParameters]
}

class FolderService @Inject()(teamDAO: TeamDAO,
                              teamService: TeamService,
                              folderDAO: FolderDAO,
                              organizationDAO: OrganizationDAO)(implicit ec: ExecutionContext)
    extends LazyLogging {

  val defaultRootName: String = "Datasets"

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
      Json.obj(
        "id" -> folder._id,
        "name" -> folder.name,
        "metadata" -> folder.metadata,
        "allowedTeams" -> teamsJs,
        "allowedTeamsCumulative" -> teamsCumulativeJs,
        "isEditable" -> isEditable
      )

  def publicWritesWithParent(folderWithParent: FolderWithParent, allEditableIds: Set[ObjectId]): JsObject =
    Json.obj(
      "id" -> folderWithParent._id,
      "name" -> folderWithParent.name,
      "parent" -> folderWithParent._parent,
      "metadata" -> folderWithParent.metadata,
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

  def assertValidFolderName(name: String): Fox[Unit] =
   Fox.fromBool(!name.contains("/")) ?~> "folder.nameMustNotContainSlash"

  def getOrCreateFromPathLiteral(folderPathLiteral: String, organizationId: String)(
      implicit ctx: DBAccessContext): Fox[ObjectId] =
    for {
      organization <- organizationDAO.findOne(organizationId)
      foldersWithParents: Seq[FolderWithParent] <- folderDAO.findTreeOf(organization._rootFolder)
      root <- foldersWithParents.find(_._parent.isEmpty).toFox
      _ <- Fox.fromBool(folderPathLiteral.startsWith("/")) ?~> "pathLiteral.mustStartWithSlash"
      pathNames = folderPathLiteral.drop(1).split("/").toList
      suppliedRootName <- pathNames.headOption.toFox
      _ <- Fox.fromBool(suppliedRootName == root.name) ?~> "pathLiteral.mustStartAtOrganizationRootFolder"
      (existingFolderId, remainingPathNames) = findLowestMatchingFolder(root, foldersWithParents, pathNames)
      _ = if (remainingPathNames.nonEmpty) {
        logger.info(s"Creating new folder(s) under $existingFolderId by path literal: $remainingPathNames...")
      }
      targetFolderId <- createMissingFoldersForPathNames(existingFolderId, remainingPathNames)
    } yield targetFolderId

  private def findLowestMatchingFolder(root: FolderWithParent,
                                       foldersWithParents: Seq[FolderWithParent],
                                       pathNames: List[String]): (ObjectId, List[String]) = {

    @tailrec
    def findFolderIter(currentParent: FolderWithParent, remainingPathNames: List[String]): (ObjectId, List[String]) = {
      val nextOpt = foldersWithParents.find(folder =>
        folder._parent.contains(currentParent._id) && remainingPathNames.headOption.contains(folder.name))
      nextOpt match {
        case Some(next) => findFolderIter(next, remainingPathNames.drop(1))
        case None       => (currentParent._id, remainingPathNames)
      }
    }

    findFolderIter(root, pathNames.drop(1))
  }

  private def createMissingFoldersForPathNames(parentFolderId: ObjectId, remainingPathNames: List[String])(
      implicit ctx: DBAccessContext): Fox[ObjectId] =
    remainingPathNames match {
      case pathNamesHead :: pathNamesTail =>
        for {
          newFolder <- Fox.successful(Folder(ObjectId.generate, pathNamesHead, JsArray.empty))
          _ <- folderDAO.insertAsChild(parentFolderId, newFolder)
          folderId <- createMissingFoldersForPathNames(newFolder._id, pathNamesTail)
        } yield folderId
      case Nil => Fox.successful(parentFolderId)
    }
}

class FolderDAO @Inject()(sqlClient: SqlClient)(implicit ec: ExecutionContext)
    extends SQLDAO[Folder, FoldersRow, Folders](sqlClient) {

  protected val collection = Folders
  protected def idColumn(x: Folders): Rep[String] = x._Id
  protected def isDeletedColumn(x: Folders): Rep[Boolean] = x.isdeleted

  protected def parse(r: FoldersRow): Fox[Folder] =
    for {
      metadata <- parseMetadata(r.metadata)
    } yield Folder(ObjectId(r._Id), r.name, metadata)

  private def parseWithParent(t: (String, String, String, Option[String])): Fox[FolderWithParent] =
    for {
      metadata <- parseMetadata(t._3)
      folderWithParent = FolderWithParent(ObjectId(t._1), t._2, metadata, t._4.map(ObjectId(_)))
    } yield folderWithParent

  private def parseMetadata(literal: String): Fox[JsArray] =
    JsonHelper.parseAndValidateJson[JsArray](literal)

  override protected def readAccessQ(requestingUserId: ObjectId): SqlToken =
    readAccessQWithPrefix(requestingUserId, q"")

  private def readAccessQWithPrefix(requestingUserId: ObjectId, prefix: SqlToken): SqlToken =
    rawAccessQ(write = false, requestingUserId, prefix)

  override protected def updateAccessQ(requestingUserId: ObjectId): SqlToken =
    rawAccessQ(write = true, requestingUserId, prefix = q"")

  private def rawAccessQ(write: Boolean, requestingUserId: ObjectId, prefix: SqlToken): SqlToken = {
    val writeAccessPredicate = if (write) q"tr.isTeamManager" else q"TRUE"
    val breadCrumbsAccessForFolder =
      if (write) q"FALSE"
      else
        q"""
       -- only for read access: you may read the ancestors of a folder you can access
       ${prefix}_id IN (
         SELECT fp._ancestor
         FROM webknossos.folder_paths fp
         WHERE fp._descendant IN (
           SELECT at._folder
           FROM webknossos.folder_allowedTeams at
           JOIN webknossos.user_team_roles utr ON at._team = utr._team
           WHERE utr._user = $requestingUserId
         )
       )
       """
    val breadCrumbsAccessForDataset =
      if (write) q"FALSE"
      else
        q"""
       -- only for read access: you may read the ancestors of a dataset you can access
       ${prefix}_id IN (
         SELECT fp._ancestor
         FROM webknossos.folder_paths fp
         WHERE fp._descendant IN (
           SELECT d._folder
           FROM webknossos.datasets_ d
           LEFT JOIN webknossos.dataset_allowedTeams dt ON dt._dataset = d._id
           LEFT JOIN webknossos.user_team_roles utr ON dt._team = utr._team
           WHERE utr._user = $requestingUserId
           OR d.isPublic
         )
       )
       """
    q"""
        -- is descendant of user organization folder and user is admin or dataset manager
        ${prefix}_id IN (
          SELECT fp._descendant
          FROM webknossos.folder_paths fp
          WHERE fp._ancestor IN (
             SELECT o._rootFolder
             FROM webknossos.organizations_ o
             JOIN webknossos.users_ u ON u._organization = o._id
             WHERE u._id = $requestingUserId
             AND (
               u.isAdmin
               OR u.isDatasetManager
             )
          )
        )
        OR
          -- is descendant of a folder with allowed teams the user is in
        ${prefix}_id IN (
          SELECT fp._descendant
          FROM webknossos.folder_paths fp
          WHERE fp._ancestor IN (
            SELECT at._folder
            FROM webknossos.folder_allowedTeams at
            JOIN webknossos.user_team_roles tr ON at._team = tr._team
            WHERE tr._user = $requestingUserId
            AND $writeAccessPredicate
          )
        )
        OR
        $breadCrumbsAccessForFolder
        OR
        $breadCrumbsAccessForDataset
        """
  }

  def insertAsRoot(f: Folder): Fox[Unit] = {
    val insertPathQuery =
      q"INSERT INTO webknossos.folder_paths(_ancestor, _descendant, depth) VALUES(${f._id}, ${f._id}, 0)".asUpdate
    for {
      _ <- run(DBIO.sequence(List(insertFolderQuery(f), insertPathQuery)).transactionally)
    } yield ()
  }

  override def findOne(folderId: ObjectId)(implicit ctx: DBAccessContext): Fox[Folder] =
    for {
      accessQuery <- readAccessQuery
      rows <- run(q"SELECT $columns FROM webknossos.folders WHERE _id = $folderId AND $accessQuery".as[FoldersRow])
      parsed <- parseFirst(rows, "id")
    } yield parsed

  def countChildren(folderId: ObjectId): Fox[Int] =
    for {
      rows <- run(q"SELECT COUNT(*) FROM webknossos.folder_paths WHERE _ancestor = $folderId AND depth = 1".as[Int])
      firstRow <- rows.headOption
    } yield firstRow

  def updateName(folderId: ObjectId, name: String)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(folderId)
      _ <- run(q"UPDATE webknossos.folders SET name = $name WHERE _id = $folderId".asUpdate)
    } yield ()

  def updateMetadata(folderId: ObjectId, metadata: JsArray)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(folderId)
      _ <- run(q"UPDATE webknossos.folders SET metadata = $metadata WHERE _id = $folderId".asUpdate)
    } yield ()

  def findAllEditableIds(implicit ctx: DBAccessContext): Fox[List[ObjectId]] =
    for {
      updateAccessQuery <- accessQueryFromAccessQ(updateAccessQ)
      rows <- run(q"SELECT _id FROM webknossos.folders_ WHERE $updateAccessQuery".as[ObjectId])
    } yield rows.toList

  def isEditable(folderId: ObjectId)(implicit ctx: DBAccessContext): Fox[Boolean] =
    for {
      updateAccessQuery <- accessQueryFromAccessQ(updateAccessQ)
      rows <- run(q"""SELECT EXISTS(
                SELECT 1 FROM
                webknossos.folders_
                WHERE _id = $folderId
                AND $updateAccessQuery
              )
           """.as[Boolean])
      result <- rows.headOption
    } yield result

  def findTreeOf(folderId: ObjectId)(implicit ctx: DBAccessContext): Fox[List[FolderWithParent]] =
    for {
      accessQueryWithPrefix <- accessQueryFromAccessQWithPrefix(readAccessQWithPrefix, prefix = q"f.")
      accessQuery <- readAccessQuery
      rows <- run(q"""SELECT f._id, f.name, f.metadata, fp._ancestor
              FROM webknossos.folders_ f
              JOIN webknossos.folder_paths fp -- join to find immediate parent, this will also kick out self
              ON f._id = fp._descendant
              WHERE fp.depth = 1 AND f._id IN
              (SELECT _descendant  -- find all folder ids that are descendants
              FROM webknossos.folder_paths
              WHERE _ancestor = $folderId)
              AND $accessQueryWithPrefix
              UNION ALL SELECT _id, name, metadata, NULL -- find self again, with no parent
              FROM webknossos.folders_
              WHERE _id = $folderId
              AND $accessQuery
              """.as[(String, String, String, Option[String])])
      parsed <- Fox.combined(rows.toList.map(parseWithParent))
    } yield parsed

  def insertAsChild(parentId: ObjectId, f: Folder)(implicit ctx: DBAccessContext): Fox[Unit] = {
    val insertPathQuery =
      q"""INSERT INTO webknossos.folder_paths(_ancestor, _descendant, depth)
             SELECT _ancestor, ${f._id}, depth + 1 -- links to ancestors
             FROM webknossos.folder_paths WHERE _descendant = $parentId
             UNION ALL SELECT ${f._id}, ${f._id}, 0 -- self link
          """.asUpdate
    for {
      _ <- assertUpdateAccess(parentId)
      _ <- run(DBIO.sequence(List(insertFolderQuery(f), insertPathQuery)))
    } yield ()
  }

  def moveSubtree(idValidated: ObjectId, newParentIdValidated: ObjectId)(implicit ctx: DBAccessContext): Fox[Unit] = {
    val deleteObsoletePathsQuery =
      q"""
         DELETE FROM webknossos.folder_paths fp1
         WHERE _descendant IN (SELECT _descendant FROM webknossos.folder_paths WHERE _ancestor = $idValidated)
         AND NOT EXISTS(SELECT FROM webknossos.folder_paths fp2 WHERE fp2._ancestor = $idValidated AND fp2._descendant = fp1._descendant);
        """.asUpdate
    val insertNewPathsQuery =
      q"""
        INSERT INTO webknossos.folder_paths (_ancestor, _descendant, depth)
        SELECT supertree._ancestor, subtree._descendant, supertree.depth + subtree.depth + 1
        FROM webknossos.folder_paths supertree
        CROSS JOIN webknossos.folder_paths subtree
        WHERE subtree._ancestor = $idValidated  -- subtree is the OLD tree including self
        AND supertree._descendant = $newParentIdValidated  -- supertree is the ancestor tree of the NEW parent, including it
          """.asUpdate
    for {
      _ <- assertUpdateAccess(idValidated)
      _ <- assertUpdateAccess(newParentIdValidated)
      _ <- run(DBIO.sequence(List(deleteObsoletePathsQuery, insertNewPathsQuery)).transactionally)
    } yield ()
  }

  override def deleteOne(folderId: ObjectId)(implicit ctx: DBAccessContext): Fox[Unit] = {
    val deleteFolderQuery = q"UPDATE webknossos.folders SET isDeleted = true WHERE _id = $folderId".asUpdate
    val deletePathsQuery =
      q"DELETE FROM webknossos.folder_paths WHERE _ancestor = $folderId OR _descendant = $folderId".asUpdate
    for {
      _ <- assertDeleteAccess(folderId)
      _ <- run(DBIO.sequence(List(deleteFolderQuery, deletePathsQuery)).transactionally)
    } yield ()
  }

  private def insertFolderQuery(f: Folder): SqlAction[Int, NoStream, Effect] =
    q"INSERT INTO webknossos.folders(_id, name) VALUES (${f._id}, ${f.name})".asUpdate

}
