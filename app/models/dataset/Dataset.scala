package models.dataset

import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.geometry.{BoundingBox, Vec3Double, Vec3Int}
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Fox, JsonHelper}
import com.scalableminds.webknossos.datastore.dataformats.MagLocator
import com.scalableminds.webknossos.datastore.datareaders.AxisOrder
import com.scalableminds.webknossos.datastore.helpers.{DataSourceMagInfo, UPath}
import com.scalableminds.webknossos.datastore.models.{LengthUnit, VoxelSize}
import com.scalableminds.webknossos.datastore.models.datasource.DatasetViewConfiguration.DatasetViewConfiguration
import com.scalableminds.webknossos.datastore.models.datasource.LayerViewConfiguration.LayerViewConfiguration
import com.scalableminds.webknossos.datastore.models.datasource.{
  AdditionalAxis,
  CoordinateTransformation,
  CoordinateTransformationType,
  DataFormat,
  DataLayer,
  DataSource,
  DataSourceId,
  DataSourceStatus,
  ElementClass,
  LayerAttachment,
  LayerAttachmentDataformat,
  LayerAttachmentType,
  LayerCategory,
  StaticColorLayer,
  StaticLayer,
  StaticSegmentationLayer,
  ThinPlateSplineCorrespondences,
  DataLayerAttachments => AttachmentWrapper
}
import com.scalableminds.webknossos.datastore.services.MagPathInfo
import com.scalableminds.webknossos.schema.Tables._
import controllers.DatasetUpdateParameters

import javax.inject.Inject
import models.organization.OrganizationDAO
import play.api.i18n.{Messages, MessagesProvider}
import play.api.libs.json._
import slick.dbio.DBIO
import slick.jdbc.GetResult
import slick.jdbc.PostgresProfile.api._
import slick.jdbc.TransactionIsolation.Serializable
import slick.lifted.Rep
import slick.sql.SqlAction
import utils.sql.{SQLDAO, SimpleSQLDAO, SqlClient, SqlToken}

import scala.concurrent.ExecutionContext

case class Dataset(_id: ObjectId,
                   _dataStore: String,
                   _organization: String,
                   _publication: Option[ObjectId],
                   _uploader: Option[ObjectId],
                   _folder: ObjectId,
                   inboxSourceHash: Option[Int],
                   defaultViewConfiguration: Option[DatasetViewConfiguration] = None,
                   adminViewConfiguration: Option[DatasetViewConfiguration] = None,
                   description: Option[String] = None,
                   directoryName: String,
                   isPublic: Boolean,
                   isUsable: Boolean,
                   isVirtual: Boolean,
                   name: String,
                   voxelSize: Option[VoxelSize],
                   sharingToken: Option[String],
                   status: String,
                   logoUrl: Option[String],
                   sortingKey: Instant = Instant.now,
                   metadata: JsArray = JsArray.empty,
                   tags: List[String] = List.empty,
                   created: Instant = Instant.now,
                   isDeleted: Boolean = false)

case class DatasetCompactInfo(
    id: ObjectId,
    name: String,
    owningOrganization: String,
    folderId: ObjectId,
    isActive: Boolean,
    directoryName: String,
    created: Instant,
    isEditable: Boolean,
    lastUsedByUser: Instant,
    status: String,
    tags: List[String],
    isUnreported: Boolean,
    colorLayerNames: List[String],
    segmentationLayerNames: List[String],
) {
  def dataSourceId = new DataSourceId(directoryName, owningOrganization)
}

object DatasetCompactInfo {
  implicit val jsonFormat: Format[DatasetCompactInfo] = Json.format[DatasetCompactInfo]
}

class DatasetDAO @Inject()(sqlClient: SqlClient, datasetLayerDAO: DatasetLayerDAO, organizationDAO: OrganizationDAO)(
    implicit ec: ExecutionContext)
    extends SQLDAO[Dataset, DatasetsRow, Datasets](sqlClient) {
  protected val collection = Datasets

  protected def idColumn(x: Datasets): Rep[String] = x._Id

  protected def isDeletedColumn(x: Datasets): Rep[Boolean] = x.isdeleted

  private def parseVoxelSizeOpt(factorLiteralOpt: Option[String],
                                unitLiteralOpt: Option[String]): Fox[Option[VoxelSize]] = factorLiteralOpt match {
    case Some(factorLiteral) =>
      for {
        factor <- Vec3Double
          .fromList(parseArrayLiteral(factorLiteral).map(_.toDouble))
          .toFox ?~> "could not parse dataset voxel size"
        unitOpt <- Fox
          .runOptional(unitLiteralOpt)(LengthUnit.fromString(_).toFox) ?~> "could not parse dataset voxel size unit"
      } yield Some(unitOpt.map(unit => VoxelSize(factor, unit)).getOrElse(VoxelSize.fromFactorWithDefaultUnit(factor)))
    case None => Fox.successful(None)
  }

  protected def parse(r: DatasetsRow): Fox[Dataset] =
    for {
      voxelSize <- parseVoxelSizeOpt(r.voxelsizefactor, r.voxelsizeunit)
      defaultViewConfigurationOpt <- Fox.runOptional(r.defaultviewconfiguration)(
        JsonHelper.parseAs[DatasetViewConfiguration](_).toFox)
      adminViewConfigurationOpt <- Fox.runOptional(r.adminviewconfiguration)(
        JsonHelper.parseAs[DatasetViewConfiguration](_).toFox)
      metadata <- JsonHelper.parseAs[JsArray](r.metadata).toFox
    } yield {
      Dataset(
        ObjectId(r._Id),
        r._Datastore.trim,
        r._Organization.trim,
        r._Publication.map(ObjectId(_)),
        r._Uploader.map(ObjectId(_)),
        ObjectId(r._Folder),
        r.inboxsourcehash,
        defaultViewConfigurationOpt,
        adminViewConfigurationOpt,
        r.description,
        r.directoryname,
        r.ispublic,
        r.isusable,
        r.isvirtual,
        r.name,
        voxelSize,
        r.sharingtoken,
        r.status,
        r.logourl,
        Instant.fromSql(r.sortingkey),
        metadata,
        parseArrayLiteral(r.tags).sorted,
        Instant.fromSql(r.created),
        r.isdeleted
      )
    }

  override def anonymousReadAccessQ(token: Option[String]): SqlToken = {
    val tokenAccess = token.map(t => q"""sharingToken = $t
          OR _id IN (
            SELECT a._dataset
            FROM webknossos.annotation_privateLinks_ apl
            JOIN webknossos.annotations_ a ON apl._annotation = a._id
            WHERE apl.accessToken = $t
          )""").getOrElse(q"FALSE")
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
            SELECT _dataset
            FROM webknossos.dataset_allowedTeams dt
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
      r <- run(q"SELECT $columns FROM $existingCollectionName WHERE _id = $id AND $accessQuery".as[DatasetsRow])
      parsed <- parseFirst(r, id)
    } yield parsed

  def findAllWithSearch(isActiveOpt: Option[Boolean],
                        isUnreported: Option[Boolean],
                        organizationIdOpt: Option[String],
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
                                                      includeSubfolders,
                                                      None,
                                                      None)
      limitQuery = limitOpt.map(l => q"LIMIT $l").getOrElse(q"")
      r <- run(q"SELECT $columns FROM $existingCollectionName WHERE $selectionPredicates $limitQuery".as[DatasetsRow])
      parsed <- parseAll(r)
    } yield parsed

  def findAllCompactWithSearch(isActiveOpt: Option[Boolean] = None,
                               isUnreported: Option[Boolean] = None,
                               organizationIdOpt: Option[String] = None,
                               folderIdOpt: Option[ObjectId] = None,
                               uploaderIdOpt: Option[ObjectId] = None,
                               searchQuery: Option[String] = None,
                               requestingUserIdOpt: Option[ObjectId] = None,
                               includeSubfolders: Boolean = false,
                               statusOpt: Option[String] = None,
                               createdSinceOpt: Option[Instant] = None,
                               limitOpt: Option[Int] = None,
  )(implicit ctx: DBAccessContext): Fox[List[DatasetCompactInfo]] =
    for {
      selectionPredicates <- buildSelectionPredicates(isActiveOpt,
                                                      isUnreported,
                                                      organizationIdOpt,
                                                      folderIdOpt,
                                                      uploaderIdOpt,
                                                      searchQuery,
                                                      includeSubfolders,
                                                      statusOpt,
                                                      createdSinceOpt)
      limitQuery = limitOpt.map(l => q"LIMIT $l").getOrElse(q"")
      query = q"""
            SELECT
              d._id,
              d.name,
              o._id,
              d._folder,
              d.isUsable,
              d.directoryName,
              d.created,
              COALESCE(
                (
                  (u.isAdmin AND u._organization = d._organization) OR
                  u.isDatasetManager OR
                  d._id IN (              -- team manager of team that has access to the dataset
                    SELECT _dataset
                    FROM webknossos.dataset_allowedTeams dt
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
                ), FALSE
              ) AS isEditable,
              COALESCE(lastUsedTimes.lastUsedTime, ${Instant.zero}),
              d.status,
              d.tags,
              cl.names AS colorLayerNames,
              sl.names AS segmentationLayerNames
            FROM
            (SELECT $columns FROM $existingCollectionName WHERE $selectionPredicates $limitQuery) d
            JOIN webknossos.organizations o
              ON o._id = d._organization
            LEFT JOIN webknossos.users_ u
              ON u._id = $requestingUserIdOpt
            LEFT JOIN webknossos.dataset_lastUsedTimes lastUsedTimes
              ON lastUsedTimes._dataset = d._id AND lastUsedTimes._user = u._id
            LEFT JOIN (SELECT _dataset, ARRAY_AGG(name ORDER BY name) AS names FROM webknossos.dataset_layers WHERE category = 'color' GROUP BY _dataset) cl
              ON d._id = cl._dataset
            LEFT JOIN (SELECT _dataset, ARRAY_AGG(name ORDER BY name) AS names FROM webknossos.dataset_layers WHERE category = 'segmentation' GROUP BY _dataset) sl
              ON d._id = sl._dataset
            """
      rows <- run(
        query.as[
          (ObjectId,
           String,
           String,
           ObjectId,
           Boolean,
           String,
           Instant,
           Boolean,
           Instant,
           String,
           String,
           String,
           String)])
    } yield
      rows.toList.map(
        row =>
          DatasetCompactInfo(
            id = row._1,
            name = row._2,
            owningOrganization = row._3,
            folderId = row._4,
            isActive = row._5,
            directoryName = row._6,
            created = row._7,
            isEditable = row._8,
            lastUsedByUser = row._9,
            status = row._10,
            tags = parseArrayLiteral(row._11),
            isUnreported = DataSourceStatus.unreportedStatusList.contains(row._10),
            colorLayerNames = parseArrayLiteral(row._12),
            segmentationLayerNames = parseArrayLiteral(row._13)
        ))

  private def buildSelectionPredicates(isActiveOpt: Option[Boolean],
                                       isUnreported: Option[Boolean],
                                       organizationIdOpt: Option[String],
                                       folderIdOpt: Option[ObjectId],
                                       uploaderIdOpt: Option[ObjectId],
                                       searchQuery: Option[String],
                                       includeSubfolders: Boolean,
                                       statusOpt: Option[String],
                                       createdSinceOpt: Option[Instant])(implicit ctx: DBAccessContext): Fox[SqlToken] =
    for {
      accessQuery <- readAccessQuery
      folderPredicate = folderIdOpt match {
        case Some(folderId) if includeSubfolders =>
          q"_folder IN (SELECT _descendant FROM webknossos.folder_paths fp WHERE fp._ancestor = $folderId)"
        case Some(folderId) => q"_folder = $folderId"
        case None           => q"TRUE"
      }
      uploaderPredicate = uploaderIdOpt.map(uploaderId => q"_uploader = $uploaderId").getOrElse(q"TRUE")
      isActivePredicate = isActiveOpt.map(isActive => q"isUsable = $isActive").getOrElse(q"TRUE")
      organizationPredicate = organizationIdOpt
        .map(organizationId => q"_organization = $organizationId")
        .getOrElse(q"TRUE")
      statusPredicate = statusOpt.map(status => q"status = $status").getOrElse(q"TRUE")
      createdSincePredicate = createdSinceOpt.map(createdSince => q"created >= $createdSince").getOrElse(q"TRUE")
      searchPredicate = buildSearchPredicate(searchQuery)
      isUnreportedPredicate = buildIsUnreportedPredicate(isUnreported)
    } yield q"""
            ($folderPredicate)
        AND ($uploaderPredicate)
        AND ($searchPredicate)
        AND ($isActivePredicate)
        AND ($isUnreportedPredicate)
        AND ($organizationPredicate)
        AND ($statusPredicate)
        AND ($createdSincePredicate)
        AND $accessQuery
       """

  private def buildSearchPredicate(searchQueryOpt: Option[String]): SqlToken =
    searchQueryOpt match {
      case None => q"TRUE"
      case Some(searchQuery) =>
        val queryTokens = searchQuery.toLowerCase.trim.split(" +")
        if (queryTokens.length == 1 && queryTokens.headOption.exists(ObjectId.fromStringSync(_).isDefined)) {
          // User searched for an objectId, compare it against dataset id
          val queriedId: String = queryTokens.headOption.getOrElse("")
          q"_id = $queriedId"
        } else {
          SqlToken.joinBySeparator(queryTokens.map(queryToken => q"POSITION($queryToken IN LOWER(name)) > 0"), " AND ")
        }
    }

  private def buildIsUnreportedPredicate(isUnreportedOpt: Option[Boolean]): SqlToken =
    isUnreportedOpt match {
      case Some(true)  => q"status = ${DataSourceStatus.unreported} OR status = ${DataSourceStatus.deletedByUser}"
      case Some(false) => q"status != ${DataSourceStatus.unreported} AND status != ${DataSourceStatus.deletedByUser}"
      case None        => q"TRUE"
    }

  def countByFolder(folderId: ObjectId): Fox[Int] =
    for {
      rows <- run(q"SELECT COUNT(*) FROM $existingCollectionName WHERE _folder = $folderId".as[Int])
      firstRow <- rows.headOption.toFox
    } yield firstRow

  def isEmpty: Fox[Boolean] =
    for {
      r <- run(q"SELECT COUNT(*) FROM $existingCollectionName LIMIT 1".as[Int])
      firstRow <- r.headOption.toFox
    } yield firstRow == 0

  def countAllForOrganization(organizationId: String): Fox[Int] =
    for {
      rList <- run(q"SELECT COUNT(*) FROM $existingCollectionName WHERE _organization = $organizationId".as[Int])
      r <- rList.headOption.toFox
    } yield r

  def findOneByDirectoryNameAndOrganization(directoryName: String, organizationId: String)(
      implicit ctx: DBAccessContext): Fox[Dataset] =
    for {
      accessQuery <- readAccessQuery
      r <- run(q"""SELECT $columns
                   FROM $existingCollectionName
                   WHERE directoryName = $directoryName
                   AND _organization = $organizationId
                   AND $accessQuery
                   LIMIT 1""".as[DatasetsRow])
      parsed <- parseFirst(r, s"$organizationId/$directoryName")
    } yield parsed

  def findOneByDataSourceId(dataSourceId: DataSourceId)(implicit ctx: DBAccessContext): Fox[Dataset] =
    findOneByDirectoryNameAndOrganization(dataSourceId.directoryName, dataSourceId.organizationId)

  def doesDatasetNameExistInOrganization(datasetName: String, organizationId: String): Fox[Boolean] =
    for {
      r <- run(q"""SELECT EXISTS(SELECT 1
                   FROM $existingCollectionName
                   WHERE name = $datasetName
                   AND _organization = $organizationId
                   LIMIT 1)""".as[Boolean])
      exists <- r.headOption.toFox
    } yield exists

  // Legacy links to Datasets used their name and organizationId as identifier. In #8075 name was changed to directoryName.
  // Thus, interpreting the name as the directory name should work, as changing the directory name is not possible.
  // This way of looking up datasets should only be used for backwards compatibility.
  def findOneByNameAndOrganization(directoryName: String, organizationId: String)(
      implicit ctx: DBAccessContext): Fox[Dataset] =
    for {
      accessQuery <- readAccessQuery
      r <- run(q"""SELECT $columns
                   FROM $existingCollectionName
                   WHERE (directoryName = $directoryName)
                   AND _organization = $organizationId
                   AND $accessQuery
                   ORDER BY created ASC
                   LIMIT 1""".as[DatasetsRow])
      parsed <- parseFirst(r, s"$organizationId/$directoryName")
    } yield parsed

  def findOneByIdOrNameAndOrganization(datasetIdOpt: Option[ObjectId], datasetName: String, organizationId: String)(
      implicit ctx: DBAccessContext,
      m: MessagesProvider): Fox[Dataset] =
    datasetIdOpt
      .map(datasetId => findOne(datasetId))
      .getOrElse(findOneByNameAndOrganization(datasetName, organizationId)) ?~> Messages(
      "dataset.notFound",
      datasetIdOpt.map(_.toString).getOrElse(datasetName))

  def findAllByDirectoryNamesAndOrganization(directoryNames: List[String], organizationId: String)(
      implicit ctx: DBAccessContext): Fox[List[Dataset]] =
    for {
      accessQuery <- readAccessQuery
      r <- run(q"""SELECT $columns
                   FROM $existingCollectionName
                   WHERE directoryName IN ${SqlToken.tupleFromList(directoryNames)}
                   AND _organization = $organizationId
                   AND $accessQuery""".as[DatasetsRow]).map(_.toList)
      parsed <- parseAll(r)
    } yield parsed

  def findAllByPublication(publicationId: ObjectId)(implicit ctx: DBAccessContext): Fox[List[Dataset]] =
    for {
      accessQuery <- readAccessQuery
      r <- run(q"""SELECT $columns
                   FROM $existingCollectionName
                   WHERE _publication = $publicationId
                   AND $accessQuery""".as[DatasetsRow]).map(_.toList)
      parsed <- parseAll(r)
    } yield parsed

  /* Disambiguation method for legacy URLs and NMLs: if the user has access to multiple datasets of the same name, use the oldest.
   * This is reasonable, because the legacy URL/NML was likely created before this ambiguity became possible */
  def getOrganizationIdForDataset(datasetName: String)(implicit ctx: DBAccessContext): Fox[String] =
    for {
      accessQuery <- readAccessQuery
      rList <- run(q"""SELECT _organization
                       FROM $existingCollectionName
                       WHERE name = $datasetName
                       AND $accessQuery
                       ORDER BY created ASC
                       LIMIT 1""".as[String])
      r <- rList.headOption.toFox
    } yield r

  def getNameById(id: ObjectId)(implicit ctx: DBAccessContext): Fox[String] =
    for {
      accessQuery <- readAccessQuery
      rList <- run(q"SELECT name FROM $existingCollectionName WHERE _id = $id AND $accessQuery".as[String])
      r <- rList.headOption.toFox
    } yield r

  def getSharingTokenById(datasetId: ObjectId)(implicit ctx: DBAccessContext): Fox[Option[String]] =
    for {
      accessQuery <- readAccessQuery
      rList <- run(q"""SELECT sharingToken
                       FROM webknossos.datasets_
                       WHERE _id = $datasetId
                       AND $accessQuery""".as[Option[String]])
      r <- rList.headOption.toFox
    } yield r

  def updateSharingTokenById(datasetId: ObjectId, sharingToken: Option[String])(
      implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      accessQuery <- readAccessQuery // Read access is enough here, we want to allow anyone who can see this data to create url sharing links.
      _ <- run(q"""UPDATE webknossos.datasets
                   SET sharingToken = $sharingToken
                   WHERE _id = $datasetId
                   AND $accessQuery""".asUpdate)
    } yield ()

  def updatePartial(datasetId: ObjectId, params: DatasetUpdateParameters)(implicit ctx: DBAccessContext): Fox[Unit] = {
    val setQueries = List(
      params.description.map(d => q"description = $d"),
      params.name.map(v => q"name = $v"),
      params.sortingKey.map(v => q"sortingKey = $v"),
      params.isPublic.map(v => q"isPublic = $v"),
      params.tags.map(v => q"tags = $v"),
      params.folderId.map(v => q"_folder = $v"),
      params.metadata.map(v => q"metadata = $v"),
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

  def updateFields(datasetId: ObjectId,
                   description: Option[String],
                   name: Option[String],
                   sortingKey: Instant,
                   isPublic: Boolean,
                   tags: List[String],
                   metadata: JsArray,
                   folderId: ObjectId)(implicit ctx: DBAccessContext): Fox[Unit] = {
    val updateParameters = new DatasetUpdateParameters(
      description = Some(description),
      name = Some(name),
      sortingKey = Some(sortingKey),
      isPublic = Some(isPublic),
      tags = Some(tags),
      metadata = Some(metadata),
      folderId = Some(folderId),
      dataSource = None
    )
    updatePartial(datasetId, updateParameters)
  }

  def updateTags(id: ObjectId, tags: List[String])(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(id)
      _ <- run(q"UPDATE webknossos.datasets SET tags = $tags WHERE _id = $id".asUpdate)
    } yield ()

  def updateAdminViewConfiguration(datasetId: ObjectId, configuration: DatasetViewConfiguration)(
      implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(datasetId)
      _ <- run(q"""UPDATE webknossos.datasets
                   SET adminViewConfiguration = ${Json.toJson(configuration)}
                   WHERE _id = $datasetId""".asUpdate)
    } yield ()

  def updateUploader(datasetId: ObjectId, uploaderIdOpt: Option[ObjectId])(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(datasetId)
      _ <- run(q"""UPDATE webknossos.datasets
                   SET _uploader = $uploaderIdOpt
                   WHERE _id = $datasetId""".asUpdate)
    } yield ()

  def updateFolder(datasetId: ObjectId, folderId: ObjectId)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(datasetId)
      _ <- run(q"""UPDATE webknossos.datasets
                   SET _folder = $folderId
                   WHERE _id = $datasetId""".asUpdate)
    } yield ()

  def insertOne(d: Dataset): Fox[Unit] = {
    val adminViewConfiguration: Option[JsValue] = d.adminViewConfiguration.map(Json.toJson(_))
    val defaultViewConfiguration: Option[JsValue] = d.defaultViewConfiguration.map(Json.toJson(_))
    for {
      _ <- run(q"""INSERT INTO webknossos.datasets(
                     _id, _dataStore, _organization, _publication,
                     _uploader, _folder,
                     inboxSourceHash, defaultViewConfiguration, adminViewConfiguration,
                     description, directoryName, isPublic, isUsable, isVirtual,
                     name, voxelSizeFactor, voxelSizeUnit, status,
                     sharingToken, sortingKey, metadata, tags,
                     created, isDeleted
                   )
                   VALUES(
                     ${d._id}, ${d._dataStore}, ${d._organization}, ${d._publication},
                     ${d._uploader}, ${d._folder},
                     ${d.inboxSourceHash}, $defaultViewConfiguration, $adminViewConfiguration,
                     ${d.description}, ${d.directoryName}, ${d.isPublic}, ${d.isUsable}, ${d.isVirtual},
                     ${d.name}, ${d.voxelSize.map(_.factor)}, ${d.voxelSize.map(_.unit)}, ${d.status.take(1024)},
                     ${d.sharingToken}, ${d.sortingKey}, ${d.metadata}, ${d.tags},
                     ${d.created}, ${d.isDeleted}
                   )""".asUpdate)
    } yield ()
  }

  def updateDataSource(id: ObjectId,
                       dataStoreName: String,
                       inboxSourceHash: Int,
                       newDataSource: DataSource,
                       isUsable: Boolean)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      organization <- organizationDAO.findOne(newDataSource.id.organizationId)
      defaultViewConfiguration: Option[JsValue] = newDataSource.defaultViewConfiguration.map(Json.toJson(_))
      _ <- run(q"""UPDATE webknossos.datasets
                   SET
                     _dataStore = $dataStoreName,
                     _organization = ${organization._id},
                     inboxSourceHash = $inboxSourceHash,
                     defaultViewConfiguration = $defaultViewConfiguration,
                     isUsable = $isUsable,
                     voxelSizeFactor = ${newDataSource.voxelSizeOpt.map(_.factor)},
                     voxelSizeUnit = ${newDataSource.voxelSizeOpt.map(_.unit)},
                     status = ${newDataSource.statusOpt.getOrElse("").take(1024)}
                   WHERE _id = $id""".asUpdate)
      _ <- datasetLayerDAO.updateLayers(id, newDataSource)
    } yield ()

  def updateDatasetStatusByDatasetId(id: ObjectId, newStatus: String, isUsable: Boolean)(
      implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(id)
      _ <- run(q"""UPDATE webknossos.datasets
                   SET
                     isUsable = $isUsable,
                     status = $newStatus
                   WHERE _id = $id""".asUpdate)
    } yield ()

  def makeVirtual(datasetId: ObjectId)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(datasetId)
      _ <- run(q"UPDATE webknossos.datasets SET isVirtual = ${true} WHERE _id = $datasetId".asUpdate)
    } yield ()

  def deactivateUnreported(existingDatasetIds: List[ObjectId],
                           dataStoreName: String,
                           organizationId: Option[String],
                           unreportedStatus: String): Fox[Unit] = {
    val inSelectedOrga = organizationId.map(id => q"_organization = $id").getOrElse(q"TRUE")
    val inclusionPredicate =
      if (existingDatasetIds.isEmpty) q"NOT isVirtual AND $inSelectedOrga"
      else q"_id NOT IN ${SqlToken.tupleFromList(existingDatasetIds)} AND NOT isVirtual AND $inSelectedOrga"
    val statusNotAlreadyInactive = q"status NOT IN ${SqlToken.tupleFromList(DataSourceStatus.inactiveStatusList)}"
    val deleteMagsQuery =
      q"""DELETE FROM webknossos.dataset_mags
         WHERE _dataset IN (
           SELECT _id
           FROM webknossos.datasets
           WHERE _dataStore = $dataStoreName
           AND $inclusionPredicate
         )""".asUpdate
    val deleteLayersQuery =
      q"""DELETE FROM webknossos.dataset_layers
          WHERE _dataset IN (
            SELECT _id
            FROM webknossos.datasets
            WHERE _dataStore = $dataStoreName
            AND $inclusionPredicate
          )""".asUpdate
    val setToUnusableQuery =
      q"""UPDATE webknossos.datasets
          SET isUsable = false, status = $unreportedStatus, voxelSizeFactor = NULL, voxelSizeUnit = NULL, inboxSourceHash = NULL
          WHERE _dataStore = $dataStoreName
          AND $inclusionPredicate
          AND $statusNotAlreadyInactive""".asUpdate
    for {
      _ <- run(DBIO.sequence(List(deleteMagsQuery, deleteLayersQuery, setToUnusableQuery)).transactionally)
    } yield ()
  }

  def deleteDataset(datasetId: ObjectId, onlyMarkAsDeleted: Boolean = false): Fox[Unit] = {
    val deleteMagsQuery =
      q"DELETE FROM webknossos.dataset_mags WHERE _dataset = $datasetId".asUpdate
    val deleteCoordinateTransformsQuery =
      q"DELETE FROM webknossos.dataset_layer_coordinateTransformations WHERE _dataset = $datasetId".asUpdate
    val deleteLayersQuery =
      q"DELETE FROM webknossos.dataset_layers WHERE _dataset = $datasetId".asUpdate
    val deleteAllowedTeamsQuery = q"DELETE FROM webknossos.dataset_allowedTeams WHERE _dataset = $datasetId".asUpdate
    val deleteAdditionalAxesQuery =
      q"DELETE FROM webknossos.dataset_layer_additionalAxes WHERE _dataset = $datasetId".asUpdate
    val deleteDatasetQuery =
      if (onlyMarkAsDeleted)
        q"UPDATE webknossos.datasets SET status = ${DataSourceStatus.deletedByUser}, isUsable = false WHERE _id = $datasetId".asUpdate
      else
        q"DELETE FROM webknossos.datasets WHERE _id = $datasetId".asUpdate

    for {
      _ <- run(
        DBIO
          .sequence(
            List(deleteMagsQuery,
                 deleteAdditionalAxesQuery,
                 deleteLayersQuery,
                 deleteAllowedTeamsQuery,
                 deleteCoordinateTransformsQuery,
                 deleteDatasetQuery))
          .transactionally)
    } yield ()
  }
}

case class MagWithPaths(layerName: String,
                        mag: Vec3Int,
                        path: Option[String],
                        realPath: Option[String],
                        hasLocalData: Boolean)

case class DataSourceMagRow(_dataset: ObjectId,
                            dataLayerName: String,
                            mag: Vec3Int,
                            path: Option[String],
                            realPath: Option[String],
                            hasLocalData: Boolean,
                            _organization: String,
                            directoryName: String)

class DatasetMagsDAO @Inject()(sqlClient: SqlClient)(implicit ec: ExecutionContext)
    extends SQLDAO[MagWithPaths, DatasetMagsRow, DatasetMags](sqlClient) {
  protected val collection = DatasetMags

  protected def idColumn(x: DatasetMags): Rep[String] = x._Dataset

  protected def isDeletedColumn(x: DatasetMags): Rep[Boolean] = false

  protected def parse(row: DatasetMagsRow): Fox[MagWithPaths] =
    for {
      mag <- Vec3Int
        .fromList(parseArrayLiteral(row.mag).map(_.toInt))
        .toFox ?~> "Could not parse mag of dataset_mags row."
    } yield MagWithPaths(row.datalayername, mag, row.path, row.realpath, hasLocalData = row.haslocaldata)

  private def parseMag(magArrayLiteral: String): Fox[Vec3Int] =
    for {
      mag <- Vec3Int.fromList(parseArrayLiteral(magArrayLiteral).map(_.toInt)).toFox ?~> "Could not parse mag."
    } yield mag

  def findMagLocatorsForLayer(datasetId: ObjectId, dataLayerName: String): Fox[List[MagLocator]] =
    for {
      rows <- run(
        q"""SELECT _dataset, dataLayerName, mag, path, realPath, hasLocalData, axisOrder, channelIndex, credentialId
       FROM webknossos.dataset_mags WHERE _dataset = $datasetId AND dataLayerName = $dataLayerName"""
          .as[DatasetMagsRow])
      magLocators <- Fox.combined(rows.map(parseMagLocator))
    } yield magLocators

  def findAllStorageRelevantMags(organizationId: String,
                                 dataStoreId: String,
                                 datasetIdOpt: Option[ObjectId]): Fox[List[DataSourceMagRow]] =
    for {
      storageRelevantMags <- run(q"""
            WITH ranked AS (
              SELECT
                ds._id AS dataset_id, mag.dataLayerName, mag.mag, mag.path, mag.realPath, mag.hasLocalData,
                ds._organization, ds._dataStore, ds.directoryName,
                -- rn is the rank of the mags with the same path. It is used to deduplicate mags with the same path to
                -- count each physical mag only once. Filtering is done below.
                ROW_NUMBER() OVER (
                  PARTITION BY COALESCE(mag.realPath, mag.path)
                  ORDER BY ds.created ASC
                ) AS rn
              FROM webknossos.dataset_mags AS mag
              JOIN webknossos.datasets AS ds
                ON mag._dataset = ds._id
            )
            SELECT
              dataset_id, dataLayerName, mag, path, realPath, hasLocalData, _organization, directoryName
            FROM ranked
            -- Filter !after! grouping mags with the same path,
            -- so mags shared between organizations are deduplicated properly using rn.
            WHERE rn = 1
              AND ranked._organization = $organizationId
              AND ranked._dataStore = $dataStoreId
              ${datasetIdOpt.map(datasetId => q"AND ranked.dataset_id = $datasetId").getOrElse(q"")};
            """.as[DataSourceMagRow])
    } yield storageRelevantMags.toList

  def updateMags(datasetId: ObjectId, dataLayers: List[StaticLayer]): Fox[Unit] = {
    val clearQuery = q"DELETE FROM webknossos.dataset_mags WHERE _dataset = $datasetId".asUpdate
    val insertQueries = dataLayers.flatMap { layer: StaticLayer =>
      layer.mags.map { mag =>
        q"""INSERT INTO webknossos.dataset_mags(_dataset, dataLayerName, mag, path, realPath, axisOrder, channelIndex, credentialId)
            VALUES($datasetId, ${layer.name}, ${mag.mag}, ${mag.path}, ${mag.path}, ${mag.axisOrder.map(Json.toJson(_))}, ${mag.channelIndex}, ${mag.credentialId})
           """.asUpdate
      }
    }
    replaceSequentiallyAsTransaction(clearQuery, insertQueries)
  }

  def updateMagPathsForDataset(datasetId: ObjectId, magPathInfos: List[MagPathInfo]): Fox[Unit] =
    for {
      _ <- Fox.successful(())
      updateQueries = magPathInfos.map(magPathInfo => {
        val magLiteral = s"(${magPathInfo.mag.x}, ${magPathInfo.mag.y}, ${magPathInfo.mag.z})"
        q"""UPDATE webknossos.dataset_mags
                 SET path = ${magPathInfo.path}, realPath = ${magPathInfo.realPath}, hasLocalData = ${magPathInfo.hasLocalData}
                 WHERE _dataset = $datasetId
                  AND dataLayerName = ${magPathInfo.layerName}
                  AND mag = CAST($magLiteral AS webknossos.vector3)""".asUpdate
      })
      composedQuery = DBIO.sequence(updateQueries)
      _ <- run(
        composedQuery.transactionally.withTransactionIsolation(Serializable),
        retryCount = 50,
        retryIfErrorContains = List(transactionSerializationError)
      )
    } yield ()

  implicit def GetResultDataSourceMagRow: GetResult[DataSourceMagRow] =
    GetResult(
      r => {
        val datasetId = ObjectId(r.nextString())
        val layerName = r.nextString()
        val magLiteral = r.nextString()
        val parsedMagOpt = Vec3Int.fromList(parseArrayLiteral(magLiteral).map(_.toInt))
        DataSourceMagRow(
          datasetId,
          layerName,
          parsedMagOpt.getOrElse(
            // Abort row parsing if the value is invalid. Will be converted into a DBIO Error.
            throw new IllegalArgumentException(
              s"Invalid mag literal for dataset $datasetId with value: '$magLiteral'"
            )
          ),
          r.nextStringOption(),
          r.nextStringOption(),
          r.nextBoolean(),
          r.nextString(),
          r.nextString()
        )
      }
    )

  private def rowsToMagInfos(rows: Vector[DataSourceMagRow]): List[DataSourceMagInfo] = {
    val mags = rows.map(_.mag)
    val dataSources = rows.map(row => DataSourceId(row.directoryName, row._organization))
    rows.toList.zip(mags).zip(dataSources).map {
      case ((row, mag), dataSource) =>
        DataSourceMagInfo(dataSource, row.dataLayerName, mag, row.path, row.realPath, row.hasLocalData)
    }
  }

  def findPathsForDatasetAndDatalayer(datasetId: ObjectId, dataLayerName: String): Fox[List[DataSourceMagInfo]] =
    for {
      rows <- run(q"""SELECT _dataset, dataLayerName, mag, path, realPath, hasLocalData, _organization, directoryName
            FROM webknossos.dataset_mags
            INNER JOIN webknossos.datasets ON webknossos.dataset_mags._dataset = webknossos.datasets._id
            WHERE _dataset = $datasetId
            AND dataLayerName = $dataLayerName""".as[DataSourceMagRow])
      magInfos = rowsToMagInfos(rows)
    } yield magInfos

  def findAllByRealPath(realPath: String): Fox[List[DataSourceMagInfo]] =
    for {
      rows <- run(q"""SELECT _dataset, dataLayerName, mag, path, realPath, hasLocalData, _organization, directoryName
            FROM webknossos.dataset_mags
            INNER JOIN webknossos.datasets ON webknossos.dataset_mags._dataset = webknossos.datasets._id
            WHERE realPath = $realPath""".as[DataSourceMagRow])
      magInfos = rowsToMagInfos(rows)
    } yield magInfos

  def findPathsUsedOnlyByThisDataset(datasetId: ObjectId): Fox[Seq[UPath]] =
    for {
      pathsStr <- run(q"""
           SELECT m1.path FROM webknossos.dataset_mags m1
           WHERE m1._dataset = $datasetId
           AND NOT EXISTS (
              SELECT m2.path
              FROM webknossos.dataset_mags m2
              WHERE m2._dataset != $datasetId
              AND (
                m2.path = m1.path
                OR
                m2.realpath = m1.realpath
              )
           )
              """.as[String])
      paths <- pathsStr.map(UPath.fromString).toList.toSingleBox("Invalid UPath").toFox
    } yield paths

  def findDatasetsWithMagsInDir(absolutePath: UPath,
                                dataStore: DataStore,
                                ignoredDataset: ObjectId): Fox[Seq[ObjectId]] = {
    // ensure trailing slash on absolutePath to avoid string prefix false positives
    val absolutePathWithTrailingSlash =
      if (absolutePath.toString.endsWith("/")) absolutePath.toString else absolutePath.toString + "/"
    run(q"""
        SELECT d._id FROM webknossos.dataset_mags m
        JOIN webknossos.datasets d ON m._dataset = d._id
        WHERE starts_with(m.realpath, $absolutePathWithTrailingSlash)
        AND d._id != $ignoredDataset
        AND d._datastore = ${dataStore.name.trim}
       """.as[ObjectId])
  }

  private def parseMagLocator(row: DatasetMagsRow): Fox[MagLocator] =
    for {
      mag <- parseMag(row.mag)
      axisOrderParsed = row.axisorder match {
        case Some(axisOrder) => JsonHelper.parseAs[AxisOrder](axisOrder).toOption
        case None            => None
      }
      path <- Fox.runOptional(row.path)(UPath.fromString(_).toFox)
    } yield
      MagLocator(
        mag,
        path,
        None,
        axisOrderParsed,
        row.channelindex,
        row.credentialid
      )

}

class DatasetLayerDAO @Inject()(sqlClient: SqlClient,
                                datasetMagsDAO: DatasetMagsDAO,
                                datasetCoordinateTransformationsDAO: DatasetCoordinateTransformationsDAO,
                                datasetLayerAdditionalAxesDAO: DatasetLayerAdditionalAxesDAO,
                                datasetLayerAttachmentsDAO: DatasetLayerAttachmentsDAO)(implicit ec: ExecutionContext)
    extends SimpleSQLDAO(sqlClient) {

  private def parseRow(row: DatasetLayersRow, datasetId: ObjectId): Fox[StaticLayer] = {
    val result: Fox[Fox[StaticLayer]] = for {
      category <- LayerCategory.fromString(row.category).toFox ?~> "Could not parse Layer Category"
      boundingBox <- BoundingBox
        .fromSQL(parseArrayLiteral(row.boundingbox).map(_.toInt))
        .toFox ?~> "Could not parse bounding box"
      elementClass <- ElementClass.fromString(row.elementclass).toFox ?~> "Could not parse Layer ElementClass"
      magLocators <- datasetMagsDAO.findMagLocatorsForLayer(datasetId, row.name) ?~> "Could not find magLocators for layer"
      defaultViewConfigurationOpt <- Fox.runOptional(row.defaultviewconfiguration)(
        JsonHelper.parseAs[LayerViewConfiguration](_).toFox)
      adminViewConfigurationOpt <- Fox.runOptional(row.adminviewconfiguration)(
        JsonHelper.parseAs[LayerViewConfiguration](_).toFox)
      coordinateTransformations <- datasetCoordinateTransformationsDAO.findCoordinateTransformationsForLayer(datasetId,
                                                                                                             row.name)
      coordinateTransformationsOpt = if (coordinateTransformations.isEmpty) None else Some(coordinateTransformations)
      additionalAxes <- datasetLayerAdditionalAxesDAO.findAllForDatasetAndDataLayerName(datasetId, row.name)
      additionalAxesOpt = if (additionalAxes.isEmpty) None else Some(additionalAxes)
      attachments <- datasetLayerAttachmentsDAO.findAllForDatasetAndDataLayerName(datasetId, row.name)
      attachmentsOpt = if (attachments.isEmpty) None else Some(attachments)
      dataFormat <- row.dataformat.flatMap(df => DataFormat.fromString(df)).toFox
    } yield {
      category match {
        case LayerCategory.segmentation =>
          val mappingsAsSet = row.mappings.map(parseArrayLiteral(_).toSet)
          Fox.successful(
            StaticSegmentationLayer(
              name = row.name,
              dataFormat = dataFormat,
              boundingBox = boundingBox,
              elementClass = elementClass,
              mags = magLocators.sortBy(_.mag.maxDim),
              defaultViewConfiguration = defaultViewConfigurationOpt,
              adminViewConfiguration = adminViewConfigurationOpt,
              coordinateTransformations = coordinateTransformationsOpt,
              additionalAxes = additionalAxesOpt,
              attachments = attachmentsOpt,
              largestSegmentId = row.largestsegmentid,
              mappings = mappingsAsSet.flatMap(m => if (m.isEmpty) None else Some(m))
            ))
        case LayerCategory.color =>
          Fox.successful(
            StaticColorLayer(
              name = row.name,
              dataFormat = dataFormat,
              boundingBox = boundingBox,
              elementClass = elementClass,
              mags = magLocators.sortBy(_.mag.maxDim),
              defaultViewConfiguration = defaultViewConfigurationOpt,
              adminViewConfiguration = adminViewConfigurationOpt,
              coordinateTransformations = coordinateTransformationsOpt,
              additionalAxes = additionalAxesOpt,
              attachments = attachmentsOpt
            ))
        case _ => Fox.failure(s"Could not match dataset layer with category $category")
      }
    }
    result.flatten
  }

  def findAllForDataset(datasetId: ObjectId): Fox[List[StaticLayer]] =
    for {
      rows <- run(q"""SELECT _dataset, name, category, elementClass, boundingBox, largestSegmentId, mappings,
                          defaultViewConfiguration, adminViewConfiguration, numChannels, dataFormat
                      FROM webknossos.dataset_layers
                      WHERE _dataset = $datasetId
                      ORDER BY name""".as[DatasetLayersRow])
      rowsParsed <- Fox.combined(rows.toList.map(parseRow(_, datasetId)))
    } yield rowsParsed

  private def insertLayerQuery(datasetId: ObjectId, layer: StaticLayer): SqlAction[Int, NoStream, Effect] =
    layer match {
      case s: StaticSegmentationLayer =>
        val mappings = s.mappings.getOrElse(Set()).toList
        q"""INSERT INTO webknossos.dataset_layers(_dataset, name, category, elementClass, boundingBox, largestSegmentId, mappings, defaultViewConfiguration, adminViewConfiguration, dataFormat, numChannels)
                    VALUES($datasetId, ${s.name}, ${s.category}, ${s.elementClass},
                    ${s.boundingBox}, ${s.largestSegmentId}, $mappings,
                    ${s.defaultViewConfiguration.map(Json.toJson(_))},
                    ${s.adminViewConfiguration.map(Json.toJson(_))},
                    ${s.dataFormat}, ${s.numChannels})
            ON CONFLICT (_dataset, name) DO UPDATE
            SET
              category = ${s.category},
              elementClass = ${s.elementClass},
              boundingBox = ${s.boundingBox},
              largestSegmentId = ${s.largestSegmentId},
              mappings = $mappings,
              defaultViewConfiguration = ${s.defaultViewConfiguration.map(Json.toJson(_))},
              adminViewConfiguration = ${s.adminViewConfiguration.map(Json.toJson(_))},
              numChannels = ${s.numChannels},
              dataFormat = ${s.dataFormat} """.asUpdate
      case d: StaticColorLayer =>
        q"""INSERT INTO webknossos.dataset_layers(_dataset, name, category, elementClass, boundingBox, defaultViewConfiguration, adminViewConfiguration, dataFormat, numChannels)
                    VALUES($datasetId, ${d.name}, ${d.category}, ${d.elementClass},
                    ${d.boundingBox},
                    ${d.defaultViewConfiguration.map(Json.toJson(_))},
                    ${d.adminViewConfiguration.map(Json.toJson(_))},
                    ${d.dataFormat}, ${d.numChannels})
            ON CONFLICT (_dataset, name) DO UPDATE
            SET
              category = ${d.category},
              elementClass = ${d.elementClass},
              boundingBox = ${d.boundingBox},
              defaultViewConfiguration = ${d.defaultViewConfiguration.map(Json.toJson(_))},
              adminViewConfiguration = ${d.adminViewConfiguration.map(Json.toJson(_))},
              numChannels = ${d.numChannels},
              dataFormat = ${d.dataFormat}""".asUpdate
      case _ => throw new Exception("DataLayer type mismatch")
    }

  def updateLayers(datasetId: ObjectId, source: DataSource): Fox[Unit] = {
    def clearQuery(dataLayers: Seq[StaticLayer]) =
      if (dataLayers.isEmpty) {
        q"DELETE FROM webknossos.dataset_layers WHERE _dataset = $datasetId".asUpdate
      } else {
        q"""DELETE FROM webknossos.dataset_layers
          WHERE _dataset = $datasetId
          AND name NOT IN ${SqlToken.tupleFromList(dataLayers.map(_.name))}""".asUpdate
      }

    val layers = source.allLayers

    val queries = clearQuery(layers) :: layers.map(insertLayerQuery(datasetId, _))

    for {
      _ <- run(DBIO.sequence(queries))
      _ <- datasetMagsDAO.updateMags(datasetId, layers)
      _ <- datasetCoordinateTransformationsDAO.updateCoordinateTransformations(datasetId, layers)
      _ <- datasetLayerAttachmentsDAO.updateAttachments(datasetId, layers)
      _ <- datasetLayerAdditionalAxesDAO.updateAdditionalAxes(datasetId, layers)
    } yield ()
  }

  def updateLayerAdminViewConfiguration(datasetId: ObjectId,
                                        layerName: String,
                                        adminViewConfiguration: LayerViewConfiguration): Fox[Unit] =
    for {
      _ <- run(q"""UPDATE webknossos.dataset_layers
                   SET adminViewConfiguration = ${Json.toJson(adminViewConfiguration)}
                   WHERE _dataset = $datasetId
                   AND name = $layerName""".asUpdate)
    } yield ()
}

class DatasetLastUsedTimesDAO @Inject()(sqlClient: SqlClient)(implicit ec: ExecutionContext)
    extends SimpleSQLDAO(sqlClient) {
  def findForDatasetAndUser(datasetId: ObjectId, userId: ObjectId): Fox[Instant] =
    for {
      rList <- run(q"""SELECT lastUsedTime
                       FROM webknossos.dataset_lastUsedTimes
                       WHERE _dataset = $datasetId
                       AND _user = $userId""".as[Instant])
      r <- rList.headOption.toFox
    } yield r

  def updateForDatasetAndUser(datasetId: ObjectId, userId: ObjectId): Fox[Unit] = {
    val clearQuery =
      q"DELETE FROM webknossos.dataset_lastUsedTimes WHERE _dataset = $datasetId AND _user = $userId".asUpdate
    val insertQuery =
      q"INSERT INTO webknossos.dataset_lastUsedTimes(_dataset, _user, lastUsedTime) VALUES($datasetId, $userId, NOW())".asUpdate
    val composedQuery = DBIO.sequence(List(clearQuery, insertQuery))
    for {
      _ <- run(composedQuery.transactionally.withTransactionIsolation(Serializable),
               retryCount = 50,
               retryIfErrorContains = List(transactionSerializationError))
    } yield ()
  }
}

case class StorageRelevantDataLayerAttachment(
    _dataset: ObjectId,
    layerName: String,
    name: String,
    path: String,
    `type`: LayerAttachmentType.LayerAttachmentType,
    _organization: String,
    datasetDirectoryName: String,
)

class DatasetLayerAttachmentsDAO @Inject()(sqlClient: SqlClient)(implicit ec: ExecutionContext)
    extends SimpleSQLDAO(sqlClient) {

  private def parseRow(row: DatasetLayerAttachmentsRow): Fox[LayerAttachment] =
    for {
      dataFormat <- LayerAttachmentDataformat.fromString(row.dataformat).toFox ?~> "Could not parse data format"
      path <- UPath.fromString(row.path).toFox
    } yield LayerAttachment(row.name, path, dataFormat)

  private def parseAttachments(rows: List[DatasetLayerAttachmentsRow]): Fox[AttachmentWrapper] =
    for {
      meshFiles <- Fox.serialCombined(rows.filter(_.`type` == LayerAttachmentType.mesh.toString))(parseRow)
      agglomerateFiles <- Fox.serialCombined(rows.filter(_.`type` == LayerAttachmentType.agglomerate.toString))(
        parseRow)
      connectomeFiles <- Fox.serialCombined(rows.filter(_.`type` == LayerAttachmentType.connectome.toString))(parseRow)
      segmentIndexFiles <- Fox.serialCombined(rows.filter(_.`type` == LayerAttachmentType.segmentIndex.toString))(
        parseRow)
      cumsumFiles <- Fox.serialCombined(rows.filter(_.`type` == LayerAttachmentType.cumsum.toString))(parseRow)
    } yield
      AttachmentWrapper(
        agglomerates = agglomerateFiles,
        connectomes = connectomeFiles,
        segmentIndex = segmentIndexFiles.headOption,
        meshes = meshFiles,
        cumsum = cumsumFiles.headOption
      )

  def findAllForDatasetAndDataLayerName(datasetId: ObjectId, layerName: String): Fox[AttachmentWrapper] =
    for {
      rows <- run(q"""SELECT _dataset, layerName, name, path, type, dataFormat, uploadToPathIsPending
                FROM webknossos.dataset_layer_attachments
                WHERE _dataset = $datasetId
                AND layerName = $layerName
                AND NOT uploadToPathIsPending""".as[DatasetLayerAttachmentsRow])
      attachments <- parseAttachments(rows.toList) ?~> "Could not parse attachments"
    } yield attachments

  def updateAttachments(datasetId: ObjectId, dataLayers: List[StaticLayer]): Fox[Unit] = {
    def insertQuery(attachment: LayerAttachment, layerName: String, attachmentType: LayerAttachmentType.Value) = {
      val query =
        q"""INSERT INTO webknossos.dataset_layer_attachments(_dataset, layerName, name, path, type, dataFormat, uploadToPathIsPending)
          VALUES($datasetId, $layerName, ${attachment.name}, ${attachment.path}, $attachmentType::webknossos.LAYER_ATTACHMENT_TYPE,
          ${attachment.dataFormat}::webknossos.LAYER_ATTACHMENT_DATAFORMAT, ${false})"""
      query.asUpdate
    }

    val clearQuery =
      q"DELETE FROM webknossos.dataset_layer_attachments WHERE _dataset = $datasetId AND NOT uploadToPathIsPending".asUpdate
    val insertQueries = dataLayers.flatMap { layer: StaticLayer =>
      layer.attachments match {
        case Some(attachments) =>
          attachments.agglomerates.map { agglomerate =>
            insertQuery(agglomerate, layer.name, LayerAttachmentType.agglomerate)
          } ++ attachments.connectomes.map { connectome =>
            insertQuery(connectome, layer.name, LayerAttachmentType.connectome)
          } ++ attachments.segmentIndex.map { segmentIndex =>
            insertQuery(segmentIndex, layer.name, LayerAttachmentType.segmentIndex)
          } ++ attachments.meshes.map { mesh =>
            insertQuery(mesh, layer.name, LayerAttachmentType.mesh)
          } ++ attachments.cumsum.map { cumsumFile =>
            insertQuery(cumsumFile, layer.name, LayerAttachmentType.cumsum)
          }
        case None =>
          List.empty
      }
    }
    replaceSequentiallyAsTransaction(clearQuery, insertQueries)
  }

  def insertPending(datasetId: ObjectId,
                    layerName: String,
                    attachmentName: String,
                    attachmentType: LayerAttachmentType.Value,
                    attachmentDataformat: LayerAttachmentDataformat.Value,
                    attachmentPath: UPath): Fox[Unit] =
    for {
      _ <- run(
        q"""INSERT INTO webknossos.dataset_layer_attachments(_dataset, layerName, name, path, type, dataFormat, uploadToPathIsPending)
            VALUES($datasetId, $layerName, $attachmentName, $attachmentPath, $attachmentType, $attachmentDataformat, ${true})
         """.asUpdate)
    } yield ()

  def countAttachmentsIncludingPending(datasetId: ObjectId,
                                       layerName: String,
                                       attachmentName: Option[String],
                                       attachmentType: LayerAttachmentType.Value): Fox[Int] = {
    val namePredicate = attachmentName.map(name => q"name = $name").getOrElse(q"TRUE")
    for {
      rows <- run(q"""SELECT COUNT(*)
                      FROM webknossos.dataset_layer_attachments
                      WHERE _dataset = $datasetId
                      AND layerName = $layerName
                      AND $namePredicate
                      AND type = $attachmentType
                      """.as[Int])
      first <- rows.headOption.toFox
    } yield first
  }

  def finishUploadToPath(datasetId: ObjectId,
                         layerName: String,
                         attachmentName: String,
                         attachmentType: LayerAttachmentType.Value): Fox[Unit] =
    for {
      _ <- run(q"""UPDATE webknossos.dataset_layer_attachments
                   SET uploadToPathIsPending = ${false}
                   WHERE _dataset = $datasetId
                   AND layerName = $layerName
                   AND name = $attachmentName
                   AND type = $attachmentType
         """.asUpdate)
    } yield ()

  implicit def GetResultStorageRelevantDataLayerAttachment: GetResult[StorageRelevantDataLayerAttachment] =
    GetResult(
      r =>
        StorageRelevantDataLayerAttachment(
          ObjectId(r.nextString()),
          r.nextString(),
          r.nextString(),
          r.nextString(), {
            val format = r.nextString()
            LayerAttachmentType
              .fromString(format)
              .getOrElse(
                // Abort row parsing if the value is invalid. Will be converted into a DBIO Error.
                throw new IllegalArgumentException(
                  s"Invalid LayerAttachmentType value: '$format'"
                )
              )
          },
          r.nextString(),
          r.nextString(),
      ))

  def findAllStorageRelevantAttachments(organizationId: String,
                                        dataStoreId: String,
                                        datasetIdOpt: Option[ObjectId]): Fox[List[StorageRelevantDataLayerAttachment]] =
    for {
      storageRelevantAttachments <- run(q"""
          WITH ranked AS (
            SELECT
              att._dataset, att.layerName, att.name, att.path, att.type, ds._organization, ds._dataStore, ds.directoryName,
              -- rn is the rank of the attachments with the same path. It is used to deduplicate attachments with the same path
               -- to count each physical attachment only once. Filtering is done below.
              ROW_NUMBER() OVER (
                PARTITION BY att.path
                ORDER BY ds.created ASC
              ) AS rn
            FROM webknossos.dataset_layer_attachments AS att
            JOIN webknossos.datasets AS ds
              ON att._dataset = ds._id
          )
          SELECT
            _dataset, layerName, name, path, type, _organization, directoryName
          FROM ranked
          -- Filter !after! grouping attachments with the same path,
          -- so attachments shared between organizations are deduplicated properly using rn.
          WHERE ranked.rn = 1
            AND ranked._organization = $organizationId
            AND ranked._dataStore = $dataStoreId
            ${datasetIdOpt.map(datasetId => q"AND ranked._dataset = $datasetId").getOrElse(q"")};
           """.as[StorageRelevantDataLayerAttachment])
    } yield storageRelevantAttachments.toList

  def findPathsUsedOnlyByThisDataset(datasetId: ObjectId): Fox[Seq[UPath]] =
    for {
      pathsStr <- run(q"""
           SELECT a1.path FROM webknossos.dataset_layer_attachments a1
           WHERE a1._dataset = $datasetId
           AND NOT EXISTS (
              SELECT a2.path
              FROM webknossos.dataset_layer_attachments a2
              WHERE a2._dataset != $datasetId
              AND a2.path = a1.path
           )
              """.as[String])
      paths <- pathsStr.map(UPath.fromString).toList.toSingleBox("Invalid UPath").toFox
    } yield paths

  def findDatasetsWithAttachmentsInDir(absolutePath: UPath,
                                       dataStore: DataStore,
                                       ignoredDataset: ObjectId): Fox[Seq[ObjectId]] = {
    // ensure trailing slash on absolutePath to avoid string prefix false positives
    val absolutePathWithTrailingSlash =
      if (absolutePath.toString.endsWith("/")) absolutePath.toString else absolutePath.toString + "/"
    run(q"""
        SELECT d._id FROM webknossos.dataset_layer_attachments a
        JOIN webknossos.datasets d ON a._dataset = d._id
        WHERE starts_with(a.path, $absolutePathWithTrailingSlash)
        AND d._id != $ignoredDataset
        AND d._datastore = ${dataStore.name.trim}
       """.as[ObjectId])
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
      matrix <- JsonHelper.parseAs[List[List[Double]]](matrixString).toFox
    } yield CoordinateTransformation(CoordinateTransformationType.affine, Some(matrix), None)

  private def parseThinPlateSpline(correspondencesRawOpt: Option[String]): Fox[CoordinateTransformation] =
    for {
      correspondencesString <- correspondencesRawOpt.toFox
      correspondences <- JsonHelper.parseAs[ThinPlateSplineCorrespondences](correspondencesString).toFox
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

  def updateCoordinateTransformations(datasetId: ObjectId, layers: List[DataLayer]): Fox[Unit] = {
    val clearQuery =
      q"DELETE FROM webknossos.dataset_layer_coordinateTransformations WHERE _dataset = $datasetId".asUpdate
    val insertQueries = layers.flatMap { layer: DataLayer =>
      layer.coordinateTransformations.getOrElse(List.empty).zipWithIndex.map { tuple =>
        {
          val coordinateTransformation: CoordinateTransformation = tuple._1
          val insertionOrderIndex = tuple._2
          q"""INSERT INTO webknossos.dataset_layer_coordinateTransformations(_dataset, layerName, type, matrix, correspondences, insertionOrderIndex)
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
    AdditionalAxis(row.name, Seq(row.lowerbound, row.upperbound), row.index)

  def findAllForDatasetAndDataLayerName(datasetId: ObjectId, dataLayerName: String): Fox[Seq[AdditionalAxis]] =
    for {
      rows <- run(q"""SELECT _dataset, layerName, name, lowerBound, upperBound, index
                      FROM webknossos.dataset_layer_additionalAxes
                      WHERE _dataset = $datasetId AND layerName = $dataLayerName""".as[DatasetLayerAdditionalaxesRow])
      additionalAxes = rows.map(parseRow)
    } yield additionalAxes

  def updateAdditionalAxes(datasetId: ObjectId, dataLayers: List[StaticLayer]): Fox[Unit] = {
    val clearQuery =
      q"DELETE FROM webknossos.dataset_layer_additionalAxes WHERE _dataset = $datasetId".asUpdate
    val insertQueries = dataLayers.flatMap { layer: StaticLayer =>
      layer.additionalAxes.getOrElse(List.empty).map { additionalAxis =>
        {
          q"""INSERT INTO webknossos.dataset_layer_additionalAxes(_dataset, layerName, name, lowerBound, upperBound, index)
              values(
              $datasetId, ${layer.name}, ${additionalAxis.name}, ${additionalAxis.lowerBound}, ${additionalAxis.upperBound}, ${additionalAxis.index})
              """.asUpdate
        }
      }
    }
    replaceSequentiallyAsTransaction(clearQuery, insertQueries)
  }
}
