package models.binary

import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.geometry.{BoundingBox, Vec3Double, Vec3Int}
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Fox, FoxImplicits, JsonHelper}
import com.scalableminds.webknossos.datastore.models.datasource.DatasetViewConfiguration.DatasetViewConfiguration
import com.scalableminds.webknossos.datastore.models.datasource.LayerViewConfiguration.LayerViewConfiguration
import com.scalableminds.webknossos.datastore.models.datasource.inbox.{InboxDataSourceLike => InboxDataSource}
import com.scalableminds.webknossos.datastore.models.datasource.{
  AbstractDataLayer,
  AbstractSegmentationLayer,
  AdditionalAxis,
  Category,
  CoordinateTransformation,
  CoordinateTransformationType,
  ElementClass,
  ThinPlateSplineCorrespondences,
  DataLayerLike => DataLayer
}
import com.scalableminds.webknossos.schema.Tables._
import controllers.DatasetUpdateParameters

import javax.inject.Inject
import models.organization.OrganizationDAO
import play.api.libs.json._
import play.utils.UriEncoding
import slick.jdbc.PostgresProfile.api._
import slick.jdbc.TransactionIsolation.Serializable
import slick.lifted.Rep
import slick.sql.SqlAction
import utils.sql.{SQLDAO, SimpleSQLDAO, SqlClient, SqlToken}
import utils.ObjectId

import scala.concurrent.ExecutionContext

case class Dataset(
    _id: ObjectId,
    _dataStore: String,
    _organization: ObjectId,
    _publication: Option[ObjectId],
    _uploader: Option[ObjectId],
    _folder: ObjectId,
    inboxSourceHash: Option[Int],
    defaultViewConfiguration: Option[DatasetViewConfiguration] = None,
    adminViewConfiguration: Option[DatasetViewConfiguration] = None,
    description: Option[String] = None,
    displayName: Option[String] = None,
    isPublic: Boolean,
    isUsable: Boolean,
    name: String,
    scale: Option[Vec3Double],
    sharingToken: Option[String],
    status: String,
    logoUrl: Option[String],
    sortingKey: Instant = Instant.now,
    details: Option[JsObject] = None,
    tags: Set[String] = Set.empty,
    created: Instant = Instant.now,
    isDeleted: Boolean = false
) extends FoxImplicits {

  def urlEncodedName: String =
    UriEncoding.encodePathSegment(name, "UTF-8")
}

case class DatasetCompactInfo(
    id: ObjectId,
    name: String,
    owningOrganization: String,
    folderId: ObjectId,
    isActive: Boolean,
    displayName: String,
    created: Instant,
    isEditable: Boolean,
    lastUsedByUser: Instant,
    status: String,
    tags: List[String],
    isUnreported: Boolean
)

object DatasetCompactInfo {
  implicit val jsonFormat: Format[DatasetCompactInfo] = Json.format[DatasetCompactInfo]
}

class DatasetDAO @Inject()(sqlClient: SqlClient, datasetDataLayerDAO: DatasetLayerDAO, organizationDAO: OrganizationDAO)(
    implicit ec: ExecutionContext)
    extends SQLDAO[Dataset, DatasetsRow, Datasets](sqlClient) {
  protected val collection = Datasets

  protected def idColumn(x: Datasets): Rep[String] = x._Id

  protected def isDeletedColumn(x: Datasets): Rep[Boolean] = x.isdeleted

  val unreportedStatus: String = "No longer available on datastore."

  private def parseScaleOpt(literalOpt: Option[String]): Fox[Option[Vec3Double]] = literalOpt match {
    case Some(literal) =>
      for {
        scale <- Vec3Double.fromList(parseArrayLiteral(literal).map(_.toDouble)) ?~> "could not parse dataset scale"
      } yield Some(scale)
    case None => Fox.successful(None)
  }

  protected def parse(r: DatasetsRow): Fox[Dataset] =
    for {
      scale <- parseScaleOpt(r.scale)
      defaultViewConfigurationOpt <- Fox.runOptional(r.defaultviewconfiguration)(
        JsonHelper.parseAndValidateJson[DatasetViewConfiguration](_))
      adminViewConfigurationOpt <- Fox.runOptional(r.adminviewconfiguration)(
        JsonHelper.parseAndValidateJson[DatasetViewConfiguration](_))
      details <- Fox.runOptional(r.details)(JsonHelper.parseAndValidateJson[JsObject](_))
    } yield {
      Dataset(
        ObjectId(r._Id),
        r._Datastore.trim,
        ObjectId(r._Organization),
        r._Publication.map(ObjectId(_)),
        r._Uploader.map(ObjectId(_)),
        ObjectId(r._Folder),
        r.inboxsourcehash,
        defaultViewConfigurationOpt,
        adminViewConfigurationOpt,
        r.description,
        r.displayname,
        r.ispublic,
        r.isusable,
        r.name,
        scale,
        r.sharingtoken,
        r.status,
        r.logourl,
        Instant.fromSql(r.sortingkey),
        details,
        parseArrayLiteral(r.tags).toSet,
        Instant.fromSql(r.created),
        r.isdeleted
      )
    }

  override def anonymousReadAccessQ(token: Option[String]): SqlToken = {
    val tokenAccess = token.map(t => q"""sharingToken = $t
          OR _id in (
            SELECT a._dataset
            FROM webknossos.annotation_privateLinks_ apl
            JOIN webknossos.annotations_ a ON apl._annotation = a._id
            WHERE apl.accessToken = $t
          )""").getOrElse(q"${false}")
    // token can either be a dataset sharingToken or a matching annotation’s private link token
    q"isPublic OR ($tokenAccess)"
  }

  override def readAccessQ(requestingUserId: ObjectId) =
    q"""isPublic
        OR ( -- user is matching orga admin or dataset manager
          _organization IN (
            SELECT _organization
            FROM webknossos.users_
            WHERE _id = $requestingUserId
            AND (isAdmin OR isDatasetManager)
          )
        )
        OR ( -- user is in a team that is allowed for the dataset
          _id IN (
            SELECT _dataSet
            FROM webknossos.dataSet_allowedTeams dt
            JOIN webknossos.user_team_roles utr ON dt._team = utr._team
            WHERE utr._user = $requestingUserId
          )
        )
        OR ( -- user is in a team that is allowed for the folder or its ancestors
          _folder IN (
            SELECT fp._descendant
            FROM webknossos.folder_paths fp
            WHERE fp._ancestor IN (
              SELECT at._folder
              FROM webknossos.folder_allowedTeams at
              JOIN webknossos.user_team_roles utr ON at._team = utr._team
              WHERE utr._user = $requestingUserId
            )
          )
        )
        """

  override def findOne(id: ObjectId)(implicit ctx: DBAccessContext): Fox[Dataset] =
    for {
      accessQuery <- readAccessQuery
      r <- run(q"select $columns from $existingCollectionName where _id = $id and $accessQuery".as[DatasetsRow])
      parsed <- parseFirst(r, id)
    } yield parsed

  def findAllWithSearch(isActiveOpt: Option[Boolean],
                        isUnreported: Option[Boolean],
                        organizationIdOpt: Option[ObjectId],
                        folderIdOpt: Option[ObjectId],
                        uploaderIdOpt: Option[ObjectId],
                        searchQuery: Option[String],
                        includeSubfolders: Boolean,
                        limitOpt: Option[Int])(implicit ctx: DBAccessContext): Fox[List[Dataset]] =
    for {
      selectionPredicates <- buildSelectionPredicates(isActiveOpt,
                                                      isUnreported,
                                                      organizationIdOpt,
                                                      folderIdOpt,
                                                      uploaderIdOpt,
                                                      searchQuery,
                                                      includeSubfolders)
      limitQuery = limitOpt.map(l => q"LIMIT $l").getOrElse(q"")
      r <- run(q"SELECT $columns FROM $existingCollectionName WHERE $selectionPredicates $limitQuery".as[DatasetsRow])
      parsed <- parseAll(r)
    } yield parsed

  def findAllCompactWithSearch(isActiveOpt: Option[Boolean],
                               isUnreported: Option[Boolean],
                               organizationIdOpt: Option[ObjectId],
                               folderIdOpt: Option[ObjectId],
                               uploaderIdOpt: Option[ObjectId],
                               searchQuery: Option[String],
                               requestingUserIdOpt: Option[ObjectId],
                               includeSubfolders: Boolean,
                               limitOpt: Option[Int])(implicit ctx: DBAccessContext): Fox[List[DatasetCompactInfo]] =
    for {
      selectionPredicates <- buildSelectionPredicates(isActiveOpt,
                                                      isUnreported,
                                                      organizationIdOpt,
                                                      folderIdOpt,
                                                      uploaderIdOpt,
                                                      searchQuery,
                                                      includeSubfolders)
      limitQuery = limitOpt.map(l => q"LIMIT $l").getOrElse(q"")
      query = q"""
            SELECT
              d._id,
              d.name,
              o.name,
              d._folder,
              d.isUsable,
              d.displayName,
              d.created,
              COALESCE(
                (
                  (u.isAdmin AND u._organization = d._organization) OR
                  u.isDatasetManager OR
                  d._id IN (              -- team manager of team that has access to the dataset
                    SELECT _dataSet
                    FROM webknossos.dataSet_allowedTeams dt
                    JOIN webknossos.user_team_roles utr ON dt._team = utr._team
                    WHERE utr._user = u._id AND utr.isTeamManager
                  ) OR
                  d._folder IN (        -- team manager of team that has (cumulative) access to dataset folder
                    SELECT fp._descendant
                    FROM webknossos.folder_paths fp
                    WHERE fp._ancestor IN (
                      SELECT at._folder
                      FROM webknossos.folder_allowedTeams at
                      JOIN webknossos.user_team_roles utr ON at._team = utr._team
                      WHERE utr._user = u._id
                    )
                  )
                ), ${false}
              ) AS isEditable,
              COALESCE(lastUsedTimes.lastUsedTime, ${Instant.zero}),
              d.status,
              d.tags
            FROM
            (SELECT $columns FROM $existingCollectionName WHERE $selectionPredicates $limitQuery) d
            JOIN webknossos.organizations o
              ON o._id = d._organization
            LEFT JOIN webknossos.users_ u
              ON u._id = $requestingUserIdOpt
            LEFT JOIN webknossos.dataSet_lastUsedTimes lastUsedTimes
              ON lastUsedTimes._dataSet = d._id AND lastUsedTimes._user = u._id
            """
      rows <- run(
        query.as[(ObjectId, String, String, ObjectId, Boolean, String, Instant, Boolean, Instant, String, String)])
    } yield
      rows.toList.map(
        row =>
          DatasetCompactInfo(
            id = row._1,
            name = row._2,
            owningOrganization = row._3,
            folderId = row._4,
            isActive = row._5,
            displayName = row._6,
            created = row._7,
            isEditable = row._8,
            lastUsedByUser = row._9,
            status = row._10,
            tags = parseArrayLiteral(row._11),
            isUnreported = row._10 == unreportedStatus,
        ))

  private def buildSelectionPredicates(isActiveOpt: Option[Boolean],
                                       isUnreported: Option[Boolean],
                                       organizationIdOpt: Option[ObjectId],
                                       folderIdOpt: Option[ObjectId],
                                       uploaderIdOpt: Option[ObjectId],
                                       searchQuery: Option[String],
                                       includeSubfolders: Boolean)(implicit ctx: DBAccessContext): Fox[SqlToken] =
    for {
      accessQuery <- readAccessQuery
      folderPredicate = folderIdOpt match {
        case Some(folderId) if includeSubfolders =>
          q"_folder IN (select _descendant FROM webknossos.folder_paths fp WHERE fp._ancestor = $folderId)"
        case Some(folderId) => q"_folder = $folderId"
        case None           => q"${true}"
      }
      uploaderPredicate = uploaderIdOpt.map(uploaderId => q"_uploader = $uploaderId").getOrElse(q"${true}")
      isActivePredicate = isActiveOpt.map(isActive => q"isUsable = $isActive").getOrElse(q"${true}")
      organizationPredicate = organizationIdOpt
        .map(organizationId => q"_organization = $organizationId")
        .getOrElse(q"${true}")
      searchPredicate = buildSearchPredicate(searchQuery)
      isUnreportedPredicate = buildIsUnreportedPredicate(isUnreported)
    } yield q"""
            ($folderPredicate)
        AND ($uploaderPredicate)
        AND ($searchPredicate)
        AND ($isActivePredicate)
        AND ($isUnreportedPredicate)
        AND ($organizationPredicate)
        AND $accessQuery
       """

  private def buildSearchPredicate(searchQueryOpt: Option[String]): SqlToken =
    searchQueryOpt match {
      case None => q"${true}"
      case Some(searchQuery) =>
        val queryTokens = searchQuery.toLowerCase.trim.split(" +")
        SqlToken.joinBySeparator(queryTokens.map(queryToken => q"POSITION($queryToken IN LOWER(name)) > 0"), " AND ")
    }

  private def buildIsUnreportedPredicate(isUnreportedOpt: Option[Boolean]): SqlToken =
    isUnreportedOpt match {
      case Some(true)  => q"status = $unreportedStatus"
      case Some(false) => q"status != $unreportedStatus"
      case None        => q"${true}"
    }

  def countByFolder(folderId: ObjectId): Fox[Int] =
    for {
      rows <- run(q"SELECT COUNT(*) FROM $existingCollectionName WHERE _folder = $folderId".as[Int])
      firstRow <- rows.headOption
    } yield firstRow

  def isEmpty: Fox[Boolean] =
    for {
      r <- run(q"select count(*) from $existingCollectionName limit 1".as[Int])
      firstRow <- r.headOption
    } yield firstRow == 0

  def countAllForOrganization(organizationId: ObjectId): Fox[Int] =
    for {
      rList <- run(q"select count(_id) from $existingCollectionName where _organization = $organizationId".as[Int])
      r <- rList.headOption
    } yield r

  def findOneByNameAndOrganizationName(name: String, organizationName: String)(
      implicit ctx: DBAccessContext): Fox[Dataset] =
    for {
      organization <- organizationDAO.findOneByName(organizationName)(GlobalAccessContext) ?~> ("organization.notFound " + organizationName)
      dataset <- findOneByNameAndOrganization(name, organization._id)
    } yield dataset

  def findOneByNameAndOrganization(name: String, organizationId: ObjectId)(
      implicit ctx: DBAccessContext): Fox[Dataset] =
    for {
      accessQuery <- readAccessQuery
      r <- run(
        q"select $columns from $existingCollectionName where name = $name and _organization = $organizationId and $accessQuery"
          .as[DatasetsRow])
      parsed <- parseFirst(r, s"$organizationId/$name")
    } yield parsed

  def findAllByNamesAndOrganization(names: List[String], organizationId: ObjectId)(
      implicit ctx: DBAccessContext): Fox[List[Dataset]] =
    for {
      accessQuery <- readAccessQuery
      r <- run(q"""SELECT $columns
                     FROM $existingCollectionName
                     WHERE name IN ${SqlToken.tupleFromList(names)}
                     AND _organization = $organizationId
                     AND $accessQuery""".as[DatasetsRow]).map(_.toList)
      parsed <- parseAll(r)
    } yield parsed

  def findAllByPublication(publicationId: ObjectId)(implicit ctx: DBAccessContext): Fox[List[Dataset]] =
    for {
      accessQuery <- readAccessQuery
      r <- run(
        q"select $columns from $existingCollectionName where _publication = $publicationId and $accessQuery"
          .as[DatasetsRow]).map(_.toList)
      parsed <- parseAll(r)
    } yield parsed

  /* Disambiguation method for legacy URLs and NMLs: if the user has access to multiple datasets of the same name, use the oldest.
   * This is reasonable, because the legacy URL/NML was likely created before this ambiguity became possible */
  def getOrganizationForDataset(datasetName: String)(implicit ctx: DBAccessContext): Fox[ObjectId] =
    for {
      accessQuery <- readAccessQuery
      rList <- run(
        q"select _organization from $existingCollectionName where name = $datasetName and $accessQuery order by created asc"
          .as[String])
      r <- rList.headOption.toFox
      parsed <- ObjectId.fromString(r)
    } yield parsed

  def getNameById(id: ObjectId)(implicit ctx: DBAccessContext): Fox[String] =
    for {
      accessQuery <- readAccessQuery
      rList <- run(q"select name from $existingCollectionName where _id = $id and $accessQuery".as[String])
      r <- rList.headOption.toFox
    } yield r

  def getSharingTokenByName(name: String, organizationId: ObjectId)(
      implicit ctx: DBAccessContext): Fox[Option[String]] =
    for {
      accessQuery <- readAccessQuery
      rList <- run(
        q"select sharingToken from webknossos.datasets_ where name = $name and _organization = $organizationId and $accessQuery"
          .as[Option[String]])
      r <- rList.headOption.toFox
    } yield r

  def updateSharingTokenByName(name: String, organizationId: ObjectId, sharingToken: Option[String])(
      implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      accessQuery <- readAccessQuery
      _ <- run(
        q"update webknossos.datasets set sharingToken = $sharingToken where name = $name and _organization = $organizationId and $accessQuery".asUpdate)
    } yield ()

  def updatePartial(datasetId: ObjectId, params: DatasetUpdateParameters)(implicit ctx: DBAccessContext): Fox[Unit] = {
    val setQueries = List(
      params.description.map(d => q"description = $d"),
      params.displayName.map(v => q"displayName = $v"),
      params.sortingKey.map(v => q"sortingKey = $v"),
      params.isPublic.map(v => q"isPublic = $v"),
      params.tags.map(v => q"tags = $v"),
      params.folderId.map(v => q"_folder = $v"),
    ).flatten
    if (setQueries.isEmpty) {
      Fox.successful(())
    } else {
      for {
        _ <- assertUpdateAccess(datasetId)
        setQueriesJoined = SqlToken.joinBySeparator(setQueries, ", ")
        _ <- run(q"""UPDATE webknossos.datasets
                     SET
                     $setQueriesJoined
                     WHERE _id = $datasetId
                     """.asUpdate)
      } yield ()
    }
  }

  def updateFields(_id: ObjectId,
                   description: Option[String],
                   displayName: Option[String],
                   sortingKey: Instant,
                   isPublic: Boolean,
                   folderId: ObjectId)(implicit ctx: DBAccessContext): Fox[Unit] = {
    val query = for { row <- Datasets if notdel(row) && row._Id === _id.id } yield
      (row.description, row.displayname, row.sortingkey, row.ispublic, row._Folder)
    for {
      _ <- assertUpdateAccess(_id)
      _ <- run(query.update(description, displayName, sortingKey.toSql, isPublic, folderId.toString))
    } yield ()
  }

  def updateTags(id: ObjectId, tags: List[String])(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(id)
      _ <- run(q"update webknossos.datasets set tags = $tags where _id = $id".asUpdate)
    } yield ()

  def updateAdminViewConfiguration(datasetId: ObjectId, configuration: DatasetViewConfiguration)(
      implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(datasetId)
      _ <- run(q"""update webknossos.dataSets
                   set adminViewConfiguration = ${Json.toJson(configuration)}
                   where _id = $datasetId""".asUpdate)
    } yield ()

  def updateUploader(datasetId: ObjectId, uploaderIdOpt: Option[ObjectId])(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(datasetId)
      _ <- run(q"""update webknossos.dataSets
                   set _uploader = $uploaderIdOpt
                   where _id = $datasetId""".asUpdate)
    } yield ()

  def updateFolder(datasetId: ObjectId, folderId: ObjectId)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(datasetId)
      _ <- run(q"""update webknossos.dataSets
                   set _folder = $folderId
                   where _id = $datasetId""".asUpdate)
    } yield ()

  def insertOne(d: Dataset): Fox[Unit] = {
    val adminViewConfiguration: Option[JsValue] = d.adminViewConfiguration.map(Json.toJson(_))
    val defaultViewConfiguration: Option[JsValue] = d.defaultViewConfiguration.map(Json.toJson(_))
    for {
      _ <- run(
        q"""insert into webknossos.dataSets(_id, _dataStore, _organization, _publication, _uploader, _folder, inboxSourceHash, defaultViewConfiguration, adminViewConfiguration, description, displayName,
                                                         isPublic, isUsable, name, scale, status, sharingToken, sortingKey, details, tags, created, isDeleted)
           values(${d._id}, ${d._dataStore}, ${d._organization}, ${d._publication},
           ${d._uploader}, ${d._folder},
           ${d.inboxSourceHash}, $defaultViewConfiguration, $adminViewConfiguration,
           ${d.description}, ${d.displayName}, ${d.isPublic}, ${d.isUsable},
           ${d.name}, ${d.scale}, ${d.status.take(1024)},
           ${d.sharingToken}, ${d.sortingKey}, ${d.details}, ${d.tags.toList},
           ${d.created}, ${d.isDeleted})
           """.asUpdate)
    } yield ()
  }

  def updateDataSourceByNameAndOrganizationName(id: ObjectId,
                                                dataStoreName: String,
                                                inboxSourceHash: Int,
                                                source: InboxDataSource,
                                                isUsable: Boolean)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      organization <- organizationDAO.findOneByName(source.id.team)
      defaultViewConfiguration: Option[JsValue] = source.defaultViewConfiguration.map(Json.toJson(_))
      _ <- run(q"""update webknossos.dataSets
                          set _dataStore = $dataStoreName,
                              _organization = ${organization._id},
                              inboxSourceHash = $inboxSourceHash,
                              defaultViewConfiguration = $defaultViewConfiguration,
                              isUsable = $isUsable,
                              scale = ${source.scaleOpt},
                              status = ${source.statusOpt.getOrElse("").take(1024)}
                         where _id = $id""".asUpdate)
      _ <- datasetDataLayerDAO.updateLayers(id, source)
    } yield ()

  def deactivateUnreported(existingDataSetIds: List[ObjectId],
                           dataStoreName: String,
                           unreportedStatus: String,
                           inactiveStatusList: List[String]): Fox[Unit] = {
    val inclusionPredicate =
      if (existingDataSetIds.isEmpty) q"${true}"
      else q"_id not in ${SqlToken.tupleFromList(existingDataSetIds)}"
    val statusNotAlreadyInactive = q"status not in ${SqlToken.tupleFromList(inactiveStatusList)}"
    val deleteResolutionsQuery =
      q"""delete from webknossos.dataSet_resolutions where _dataset in (select _id from webknossos.datasets where _dataStore = $dataStoreName and $inclusionPredicate)""".asUpdate
    val deleteLayersQuery =
      q"""delete from webknossos.dataSet_layers where _dataset in (select _id from webknossos.datasets where _dataStore = $dataStoreName and $inclusionPredicate)""".asUpdate
    val setToUnusableQuery =
      q"""update webknossos.datasets
          set isUsable = false, status = $unreportedStatus, scale = NULL, inboxSourceHash = NULL
          where _dataStore = $dataStoreName and $inclusionPredicate and $statusNotAlreadyInactive""".asUpdate
    for {
      _ <- run(DBIO.sequence(List(deleteResolutionsQuery, deleteLayersQuery, setToUnusableQuery)).transactionally)
    } yield ()
  }

  def deleteDataset(datasetId: ObjectId): Fox[Unit] = {
    val deleteResolutionsQuery =
      q"delete from webknossos.dataSet_resolutions where _dataset = $datasetId".asUpdate
    val deleteLayersQuery =
      q"delete from webknossos.dataSet_layers where _dataset = $datasetId".asUpdate
    val deleteAllowedTeamsQuery = q"delete from webknossos.dataSet_allowedTeams where _dataset = $datasetId".asUpdate
    val deleteDatasetQuery =
      q"delete from webknossos.datasets where _id = $datasetId".asUpdate

    for {
      _ <- run(
        DBIO
          .sequence(List(deleteResolutionsQuery, deleteLayersQuery, deleteAllowedTeamsQuery, deleteDatasetQuery))
          .transactionally)
    } yield ()
  }
}

class DatasetResolutionsDAO @Inject()(sqlClient: SqlClient)(implicit ec: ExecutionContext)
    extends SimpleSQLDAO(sqlClient) {
  private def parseRow(row: DatasetResolutionsRow): Fox[Vec3Int] =
    for {
      resolution <- Vec3Int.fromList(parseArrayLiteral(row.resolution).map(_.toInt)) ?~> "could not parse resolution"
    } yield resolution

  def findDataResolutionForLayer(datasetId: ObjectId, dataLayerName: String): Fox[List[Vec3Int]] =
    for {
      rows <- run(
        DatasetResolutions.filter(r => r._Dataset === datasetId.id && r.datalayername === dataLayerName).result)
        .map(_.toList)
      rowsParsed <- Fox.combined(rows.map(parseRow)) ?~> "could not parse resolution row"
    } yield rowsParsed

  def updateResolutions(datasetId: ObjectId, dataLayersOpt: Option[List[DataLayer]]): Fox[Unit] = {
    val clearQuery = q"delete from webknossos.dataSet_resolutions where _dataSet = $datasetId".asUpdate
    val insertQueries = dataLayersOpt.getOrElse(List.empty).flatMap { layer: DataLayer =>
      layer.resolutions.map { resolution: Vec3Int =>
        {
          q"""insert into webknossos.dataSet_resolutions(_dataSet, dataLayerName, resolution)
                values($datasetId, ${layer.name}, $resolution)""".asUpdate
        }
      }
    }
    replaceSequentiallyAsTransaction(clearQuery, insertQueries)
  }

}

class DatasetLayerDAO @Inject()(
    sqlClient: SqlClient,
    datasetResolutionsDAO: DatasetResolutionsDAO,
    datasetCoordinateTransformationsDAO: DatasetCoordinateTransformationsDAO,
    datasetLayerAdditionalAxesDAO: DatasetLayerAdditionalAxesDAO)(implicit ec: ExecutionContext)
    extends SimpleSQLDAO(sqlClient) {

  private def parseRow(row: DatasetLayersRow, datasetId: ObjectId): Fox[DataLayer] = {
    val result: Fox[Fox[DataLayer]] = for {
      category <- Category.fromString(row.category).toFox ?~> "Could not parse Layer Category"
      boundingBox <- BoundingBox
        .fromSQL(parseArrayLiteral(row.boundingbox).map(_.toInt))
        .toFox ?~> "Could not parse boundingbox"
      elementClass <- ElementClass.fromString(row.elementclass).toFox ?~> "Could not parse Layer ElementClass"
      resolutions <- datasetResolutionsDAO.findDataResolutionForLayer(datasetId, row.name) ?~> "Could not find resolution for layer"
      defaultViewConfigurationOpt <- Fox.runOptional(row.defaultviewconfiguration)(
        JsonHelper.parseAndValidateJson[LayerViewConfiguration](_))
      adminViewConfigurationOpt <- Fox.runOptional(row.adminviewconfiguration)(
        JsonHelper.parseAndValidateJson[LayerViewConfiguration](_))
      coordinateTransformations <- datasetCoordinateTransformationsDAO.findCoordinateTransformationsForLayer(datasetId,
                                                                                                             row.name)
      coordinateTransformationsOpt = if (coordinateTransformations.isEmpty) None else Some(coordinateTransformations)
      additionalAxes <- datasetLayerAdditionalAxesDAO.findAllForDatasetAndDataLayerName(datasetId, row.name)
      additionalAxesOpt = if (additionalAxes.isEmpty) None else Some(additionalAxes)
    } yield {
      category match {
        case Category.segmentation =>
          val mappingsAsSet = row.mappings.map(parseArrayLiteral(_).toSet)
          Fox.successful(
            AbstractSegmentationLayer(
              row.name,
              category,
              boundingBox,
              resolutions.sortBy(_.maxDim),
              elementClass,
              row.largestsegmentid,
              mappingsAsSet.flatMap(m => if (m.isEmpty) None else Some(m)),
              defaultViewConfigurationOpt,
              adminViewConfigurationOpt,
              coordinateTransformationsOpt,
              additionalAxesOpt
            ))
        case Category.color =>
          Fox.successful(
            AbstractDataLayer(
              row.name,
              category,
              boundingBox,
              resolutions.sortBy(_.maxDim),
              elementClass,
              defaultViewConfigurationOpt,
              adminViewConfigurationOpt,
              coordinateTransformationsOpt,
              additionalAxesOpt
            ))
        case _ => Fox.failure(s"Could not match dataset layer with category $category")
      }
    }
    result.flatten
  }

  def findAllForDataset(datasetId: ObjectId): Fox[List[DataLayer]] =
    for {
      rows <- run(q"""SELECT _dataSet, name, category, elementClass, boundingBox, largestSegmentId, mappings,
                          defaultViewConfiguration, adminViewConfiguration
                      FROM webknossos.dataset_layers
                      WHERE _dataset = $datasetId
                      ORDER BY name""".as[DatasetLayersRow])
      rowsParsed <- Fox.combined(rows.toList.map(parseRow(_, datasetId)))
    } yield rowsParsed

  private def insertLayerQuery(datasetId: ObjectId, layer: DataLayer): SqlAction[Int, NoStream, Effect] =
    layer match {
      case s: AbstractSegmentationLayer =>
        val mappings = s.mappings.getOrElse(Set()).toList
        q"""insert into webknossos.dataset_layers(_dataSet, name, category, elementClass, boundingBox, largestSegmentId, mappings, defaultViewConfiguration, adminViewConfiguration)
                    values($datasetId, ${s.name}, ${s.category}, ${s.elementClass},
                    ${s.boundingBox}, ${s.largestSegmentId}, $mappings,
                    ${s.defaultViewConfiguration.map(Json.toJson(_))},
                    ${s.adminViewConfiguration.map(Json.toJson(_))})
          on conflict (_dataSet, name) do update
                     set category = ${s.category}, elementClass = ${s.elementClass},
                     boundingBox = ${s.boundingBox}, largestSegmentId = ${s.largestSegmentId},
                     mappings = $mappings,
                     defaultViewConfiguration = ${s.defaultViewConfiguration.map(Json.toJson(_))}""".asUpdate
      case d: AbstractDataLayer =>
        q"""insert into webknossos.dataset_layers(_dataSet, name, category, elementClass, boundingBox, defaultViewConfiguration, adminViewConfiguration)
                    values($datasetId, ${d.name}, ${d.category}, ${d.elementClass},
                    ${d.boundingBox},
                    ${d.defaultViewConfiguration.map(Json.toJson(_))},
                    ${d.adminViewConfiguration.map(Json.toJson(_))})
          on conflict (_dataSet, name) do update
                    set category = ${d.category}, elementClass = ${d.elementClass}, boundingBox = ${d.boundingBox},
                    defaultViewConfiguration = ${d.defaultViewConfiguration.map(Json.toJson(_))}""".asUpdate
      case _ => throw new Exception("DataLayer type mismatch")
    }

  def updateLayers(datasetId: ObjectId, source: InboxDataSource): Fox[Unit] = {
    def getSpecificClearQuery(dataLayers: List[DataLayer]) =
      q"delete from webknossos.dataset_layers where _dataSet = $datasetId and name not in ${SqlToken.tupleFromList(
        dataLayers.map(_.name))}".asUpdate
    val clearQuery = q"delete from webknossos.dataset_layers where _dataSet = $datasetId".asUpdate

    val queries = source.toUsable match {
      case Some(usable) =>
        getSpecificClearQuery(usable.dataLayers) :: usable.dataLayers.map(insertLayerQuery(datasetId, _))
      case _ => List(clearQuery)
    }

    for {
      _ <- run(DBIO.sequence(queries))
      _ <- datasetResolutionsDAO.updateResolutions(datasetId, source.toUsable.map(_.dataLayers))
      _ <- datasetCoordinateTransformationsDAO.updateCoordinateTransformations(datasetId,
                                                                               source.toUsable.map(_.dataLayers))
      _ <- datasetLayerAdditionalAxesDAO.updateAdditionalAxes(datasetId, source.toUsable.map(_.dataLayers))
    } yield ()
  }

  def updateLayerAdminViewConfiguration(datasetId: ObjectId,
                                        layerName: String,
                                        adminViewConfiguration: LayerViewConfiguration): Fox[Unit] =
    for {
      _ <- run(q"""update webknossos.dataset_layers
                   set adminViewConfiguration = ${Json.toJson(adminViewConfiguration)}
                   where _dataSet = $datasetId and name = $layerName""".asUpdate)
    } yield ()
}

class DatasetLastUsedTimesDAO @Inject()(sqlClient: SqlClient)(implicit ec: ExecutionContext)
    extends SimpleSQLDAO(sqlClient) {
  def findForDatasetAndUser(datasetId: ObjectId, userId: ObjectId): Fox[Instant] =
    for {
      rList <- run(
        q"select lastUsedTime from webknossos.dataSet_lastUsedTimes where _dataSet = $datasetId and _user = $userId"
          .as[Instant])
      r <- rList.headOption.toFox
    } yield r

  def updateForDatasetAndUser(datasetId: ObjectId, userId: ObjectId): Fox[Unit] = {
    val clearQuery =
      q"delete from webknossos.dataSet_lastUsedTimes where _dataSet = $datasetId and _user = $userId".asUpdate
    val insertQuery =
      q"insert into webknossos.dataSet_lastUsedTimes(_dataSet, _user, lastUsedTime) values($datasetId, $userId, NOW())".asUpdate
    val composedQuery = DBIO.sequence(List(clearQuery, insertQuery))
    for {
      _ <- run(composedQuery.transactionally.withTransactionIsolation(Serializable),
               retryCount = 50,
               retryIfErrorContains = List(transactionSerializationError))
    } yield ()
  }
}

class DatasetCoordinateTransformationsDAO @Inject()(sqlClient: SqlClient)(implicit ec: ExecutionContext)
    extends SimpleSQLDAO(sqlClient) {
  private def parseRow(row: DatasetLayerCoordinatetransformationsRow): Fox[CoordinateTransformation] =
    for {
      typeParsed <- CoordinateTransformationType.fromString(row.`type`).toFox
      result <- typeParsed match {
        case CoordinateTransformationType.affine            => parseAffine(row.matrix)
        case CoordinateTransformationType.thin_plate_spline => parseThinPlateSpline(row.correspondences)
        case _                                              => Fox.failure(s"Unknown coordinate transformation type: ${row.`type`}")
      }
    } yield result

  private def parseAffine(matrixRawOpt: Option[String]): Fox[CoordinateTransformation] =
    for {
      matrixString <- matrixRawOpt.toFox
      matrix <- JsonHelper.parseAndValidateJson[List[List[Double]]](matrixString)
    } yield CoordinateTransformation(CoordinateTransformationType.affine, Some(matrix), None)

  private def parseThinPlateSpline(correspondencesRawOpt: Option[String]): Fox[CoordinateTransformation] =
    for {
      correspondencesString <- correspondencesRawOpt.toFox
      correspondences <- JsonHelper.parseAndValidateJson[ThinPlateSplineCorrespondences](correspondencesString)
    } yield CoordinateTransformation(CoordinateTransformationType.thin_plate_spline, None, Some(correspondences))

  def findCoordinateTransformationsForLayer(datasetId: ObjectId,
                                            layerName: String): Fox[List[CoordinateTransformation]] =
    for {
      rows <- run(
        DatasetLayerCoordinatetransformations
          .filter(r => r._Dataset === datasetId.id && r.layername === layerName)
          .sortBy(r => r.insertionorderindex)
          .result).map(_.toList)
      rowsParsed <- Fox.combined(rows.map(parseRow)) ?~> "could not parse transformations row"
    } yield rowsParsed

  def updateCoordinateTransformations(datasetId: ObjectId, dataLayersOpt: Option[List[DataLayer]]): Fox[Unit] = {
    val clearQuery =
      q"DELETE FROM webknossos.dataSet_layer_coordinateTransformations WHERE _dataSet = $datasetId".asUpdate
    val insertQueries = dataLayersOpt.getOrElse(List.empty).flatMap { layer: DataLayer =>
      layer.coordinateTransformations.getOrElse(List.empty).zipWithIndex.map { tuple =>
        {
          val coordinateTransformation: CoordinateTransformation = tuple._1
          val insertionOrderIndex = tuple._2
          q"""INSERT INTO webknossos.dataSet_layer_coordinateTransformations(_dataSet, layerName, type, matrix, correspondences, insertionOrderIndex)
              values(
              $datasetId, ${layer.name}, ${coordinateTransformation.`type`},
              ${Json.toJson(coordinateTransformation.matrix)},
              ${Json.toJson(coordinateTransformation.correspondences)},
              $insertionOrderIndex)
              """.asUpdate
        }
      }
    }
    replaceSequentiallyAsTransaction(clearQuery, insertQueries)
  }
}

class DatasetLayerAdditionalAxesDAO @Inject()(sqlClient: SqlClient)(implicit ec: ExecutionContext)
    extends SimpleSQLDAO(sqlClient) {

  private def parseRow(row: DatasetLayerAdditionalaxesRow): AdditionalAxis =
    AdditionalAxis(row.name, Array(row.lowerbound, row.upperbound), row.index)

  def findAllForDatasetAndDataLayerName(dataSetId: ObjectId, dataLayerName: String): Fox[Seq[AdditionalAxis]] =
    for {
      rows <- run(q"""SELECT *
           FROM webknossos.dataSet_layer_additionalAxes
           WHERE _dataSet = $dataSetId AND layerName = $dataLayerName""".as[DatasetLayerAdditionalaxesRow])
      additionalAxes = rows.map(parseRow)
    } yield additionalAxes

  def updateAdditionalAxes(dataSetId: ObjectId, dataLayersOpt: Option[List[DataLayer]]): Fox[Unit] = {
    val clearQuery =
      q"DELETE FROM webknossos.dataSet_layer_additionalAxes WHERE _dataSet = $dataSetId".asUpdate
    val insertQueries = dataLayersOpt.getOrElse(List.empty).flatMap { layer: DataLayer =>
      layer.additionalAxes.getOrElse(List.empty).map { additionalAxis =>
        {
          q"""INSERT INTO webknossos.dataSet_layer_additionalAxes(_dataSet, layerName, name, lowerBound, upperBound, index)
              values(
              $dataSetId, ${layer.name}, ${additionalAxis.name}, ${additionalAxis.lowerBound}, ${additionalAxis.upperBound}, ${additionalAxis.index})
              """.asUpdate
        }

      }
    }
    replaceSequentiallyAsTransaction(clearQuery, insertQueries)
  }
}
