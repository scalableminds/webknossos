package models.binary

import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.geometry.{BoundingBox, Vec3Double, Vec3Int}
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Fox, FoxImplicits, JsonHelper}
import com.scalableminds.webknossos.datastore.models.datasource.DataSetViewConfiguration.DataSetViewConfiguration
import com.scalableminds.webknossos.datastore.models.datasource.LayerViewConfiguration.LayerViewConfiguration
import com.scalableminds.webknossos.datastore.models.datasource.inbox.{InboxDataSourceLike => InboxDataSource}
import com.scalableminds.webknossos.datastore.models.datasource.{
  AbstractDataLayer,
  AbstractSegmentationLayer,
  Category,
  ElementClass,
  DataLayerLike => DataLayer
}
import com.scalableminds.webknossos.schema.Tables._

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

case class DataSet(
    _id: ObjectId,
    _dataStore: String,
    _organization: ObjectId,
    _publication: Option[ObjectId],
    _uploader: Option[ObjectId],
    _folder: ObjectId,
    inboxSourceHash: Option[Int],
    defaultViewConfiguration: Option[DataSetViewConfiguration] = None,
    adminViewConfiguration: Option[DataSetViewConfiguration] = None,
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

class DataSetDAO @Inject()(sqlClient: SqlClient,
                           dataSetDataLayerDAO: DataSetDataLayerDAO,
                           organizationDAO: OrganizationDAO)(implicit ec: ExecutionContext)
    extends SQLDAO[DataSet, DatasetsRow, Datasets](sqlClient) {
  protected val collection = Datasets

  protected def idColumn(x: Datasets): Rep[String] = x._Id

  protected def isDeletedColumn(x: Datasets): Rep[Boolean] = x.isdeleted

  private def parseScaleOpt(literalOpt: Option[String]): Fox[Option[Vec3Double]] = literalOpt match {
    case Some(literal) =>
      for {
        scale <- Vec3Double.fromList(parseArrayLiteral(literal).map(_.toDouble)) ?~> "could not parse dataset scale"
      } yield Some(scale)
    case None => Fox.successful(None)
  }

  protected def parse(r: DatasetsRow): Fox[DataSet] =
    for {
      scale <- parseScaleOpt(r.scale)
      defaultViewConfigurationOpt <- Fox.runOptional(r.defaultviewconfiguration)(
        JsonHelper.parseAndValidateJson[DataSetViewConfiguration](_))
      adminViewConfigurationOpt <- Fox.runOptional(r.adminviewconfiguration)(
        JsonHelper.parseAndValidateJson[DataSetViewConfiguration](_))
      details <- Fox.runOptional(r.details)(JsonHelper.parseAndValidateJson[JsObject](_))
    } yield {
      DataSet(
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

  override def findOne(id: ObjectId)(implicit ctx: DBAccessContext): Fox[DataSet] =
    for {
      accessQuery <- readAccessQuery
      r <- run(q"select $columns from $existingCollectionName where _id = $id and $accessQuery".as[DatasetsRow])
      parsed <- parseFirst(r, id)
    } yield parsed

  def findAllWithSearch(folderIdOpt: Option[ObjectId], searchQuery: Option[String], includeSubfolders: Boolean = false)(
      implicit ctx: DBAccessContext): Fox[List[DataSet]] =
    for {
      accessQuery <- readAccessQuery
      folderPredicate = folderIdOpt match {
        case Some(folderId) if includeSubfolders =>
          q"_folder IN (select _descendant FROM webknossos.folder_paths fp WHERE fp._ancestor = $folderId)"
        case Some(folderId) => q"_folder = $folderId"
        case None           => q"${true}"
      }
      searchPredicate = buildSearchPredicate(searchQuery)
      r <- run(q"""SELECT $columns
              FROM $existingCollectionName
              WHERE $folderPredicate
              AND ($searchPredicate)
              AND $accessQuery
              """.as[DatasetsRow])
      parsed <- parseAll(r)
    } yield parsed

  private def buildSearchPredicate(searchQueryOpt: Option[String]): SqlToken =
    searchQueryOpt match {
      case None => q"${true}"
      case Some(searchQuery) =>
        val queryTokens = searchQuery.toLowerCase.trim.split(" +")
        SqlToken.raw(
          queryTokens.map(queryToken => s"POSITION(${escapeLiteral(queryToken)} IN LOWER(name)) > 0").mkString(" AND "))
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
      implicit ctx: DBAccessContext): Fox[DataSet] =
    for {
      organization <- organizationDAO.findOneByName(organizationName)(GlobalAccessContext) ?~> ("organization.notFound " + organizationName)
      dataset <- findOneByNameAndOrganization(name, organization._id)
    } yield dataset

  def findOneByNameAndOrganization(name: String, organizationId: ObjectId)(
      implicit ctx: DBAccessContext): Fox[DataSet] =
    for {
      accessQuery <- readAccessQuery
      r <- run(
        q"select $columns from $existingCollectionName where name = $name and _organization = $organizationId and $accessQuery"
          .as[DatasetsRow])
      parsed <- parseFirst(r, s"$organizationId/$name")
    } yield parsed

  def findAllByNamesAndOrganization(names: List[String], organizationId: ObjectId)(
      implicit ctx: DBAccessContext): Fox[List[DataSet]] =
    for {
      accessQuery <- readAccessQuery
      r <- run(q"""SELECT $columns
                     FROM $existingCollectionName
                     WHERE name IN ${SqlToken.tupleFromList(names)}
                     AND _organization = $organizationId
                     AND $accessQuery""".as[DatasetsRow]).map(_.toList)
      parsed <- parseAll(r)
    } yield parsed

  def findAllByPublication(publicationId: ObjectId)(implicit ctx: DBAccessContext): Fox[List[DataSet]] =
    for {
      accessQuery <- readAccessQuery
      r <- run(
        q"select $columns from $existingCollectionName where _publication = $publicationId and $accessQuery"
          .as[DatasetsRow]).map(_.toList)
      parsed <- parseAll(r)
    } yield parsed

  /* Disambiguation method for legacy URLs and NMLs: if the user has access to multiple datasets of the same name, use the oldest.
   * This is reasonable, because the legacy URL/NML was likely created before this ambiguity became possible */
  def getOrganizationForDataSet(dataSetName: String)(implicit ctx: DBAccessContext): Fox[ObjectId] =
    for {
      accessQuery <- readAccessQuery
      rList <- run(
        q"select _organization from $existingCollectionName where name = $dataSetName and $accessQuery order by created asc"
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
        q"update webknossos.datasets_ set sharingToken = $sharingToken where name = $name and _organization = $organizationId and $accessQuery".asUpdate)
    } yield ()

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

  def updateAdminViewConfiguration(datasetId: ObjectId, configuration: DataSetViewConfiguration)(
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

  def insertOne(d: DataSet): Fox[Unit] = {
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
      _ <- dataSetDataLayerDAO.updateLayers(id, source)
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

class DataSetResolutionsDAO @Inject()(sqlClient: SqlClient)(implicit ec: ExecutionContext)
    extends SimpleSQLDAO(sqlClient) {
  private def parseRow(row: DatasetResolutionsRow): Fox[Vec3Int] =
    for {
      resolution <- Vec3Int.fromList(parseArrayLiteral(row.resolution).map(_.toInt)) ?~> "could not parse resolution"
    } yield resolution

  def findDataResolutionForLayer(dataSetId: ObjectId, dataLayerName: String): Fox[List[Vec3Int]] =
    for {
      rows <- run(
        DatasetResolutions.filter(r => r._Dataset === dataSetId.id && r.datalayername === dataLayerName).result)
        .map(_.toList)
      rowsParsed <- Fox.combined(rows.map(parseRow)) ?~> "could not parse resolution row"
    } yield rowsParsed

  def updateResolutions(dataSetId: ObjectId, dataLayersOpt: Option[List[DataLayer]]): Fox[Unit] = {
    val clearQuery = q"delete from webknossos.dataSet_resolutions where _dataSet = $dataSetId".asUpdate
    val insertQueries = dataLayersOpt match {
      case Some(dataLayers: List[DataLayer]) =>
        dataLayers.flatMap { layer =>
          layer.resolutions.map { resolution: Vec3Int =>
            {
              q"""insert into webknossos.dataSet_resolutions(_dataSet, dataLayerName, resolution)
                  values($dataSetId, ${layer.name}, $resolution)""".asUpdate
            }
          }
        }
      case _ => List()
    }
    for {
      _ <- run(
        DBIO.sequence(List(clearQuery) ++ insertQueries).transactionally.withTransactionIsolation(Serializable),
        retryCount = 50,
        retryIfErrorContains = List(transactionSerializationError)
      )
    } yield ()
  }

}

class DataSetDataLayerDAO @Inject()(sqlClient: SqlClient, dataSetResolutionsDAO: DataSetResolutionsDAO)(
    implicit ec: ExecutionContext)
    extends SimpleSQLDAO(sqlClient) {

  private def parseRow(row: DatasetLayersRow, dataSetId: ObjectId, skipResolutions: Boolean): Fox[DataLayer] = {
    val result: Fox[Fox[DataLayer]] = for {
      category <- Category.fromString(row.category).toFox ?~> "Could not parse Layer Category"
      boundingBox <- BoundingBox
        .fromSQL(parseArrayLiteral(row.boundingbox).map(_.toInt))
        .toFox ?~> "Could not parse boundingbox"
      elementClass <- ElementClass.fromString(row.elementclass).toFox ?~> "Could not parse Layer ElementClass"
      standinResolutions: Option[List[Vec3Int]] = if (skipResolutions) Some(List.empty[Vec3Int]) else None
      resolutions <- Fox.fillOption(standinResolutions)(
        dataSetResolutionsDAO.findDataResolutionForLayer(dataSetId, row.name) ?~> "Could not find resolution for layer")
      defaultViewConfigurationOpt <- Fox.runOptional(row.defaultviewconfiguration)(
        JsonHelper.parseAndValidateJson[LayerViewConfiguration](_))
      adminViewConfigurationOpt <- Fox.runOptional(row.adminviewconfiguration)(
        JsonHelper.parseAndValidateJson[LayerViewConfiguration](_))
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
              adminViewConfigurationOpt
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
              adminViewConfigurationOpt
            ))
        case _ => Fox.failure(s"Could not match dataset layer with category $category")
      }
    }
    result.flatten
  }

  def findAllForDataSet(dataSetId: ObjectId, skipResolutions: Boolean = false): Fox[List[DataLayer]] =
    for {
      rows <- run(DatasetLayers.filter(_._Dataset === dataSetId.id).result).map(_.toList)
      rowsParsed <- Fox.combined(rows.map(parseRow(_, dataSetId, skipResolutions)))
    } yield rowsParsed

  private def insertLayerQuery(dataSetId: ObjectId, layer: DataLayer): SqlAction[Int, NoStream, Effect] =
    layer match {
      case s: AbstractSegmentationLayer =>
        val mappings = s.mappings.getOrElse(Set()).toList
        q"""insert into webknossos.dataset_layers(_dataSet, name, category, elementClass, boundingBox, largestSegmentId, mappings, defaultViewConfiguration, adminViewConfiguration)
                    values($dataSetId, ${s.name}, ${s.category}, ${s.elementClass},
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
                    values($dataSetId, ${d.name}, ${d.category}, ${d.elementClass},
                    ${d.boundingBox},
                    ${d.defaultViewConfiguration.map(Json.toJson(_))},
                    ${d.adminViewConfiguration.map(Json.toJson(_))})
          on conflict (_dataSet, name) do update
                    set category = ${d.category}, elementClass = ${d.elementClass}, boundingBox = ${d.boundingBox},
                    defaultViewConfiguration = ${d.defaultViewConfiguration.map(Json.toJson(_))}""".asUpdate
      case _ => throw new Exception("DataLayer type mismatch")
    }

  def updateLayers(dataSetId: ObjectId, source: InboxDataSource): Fox[Unit] = {
    def getSpecificClearQuery(dataLayers: List[DataLayer]) =
      q"delete from webknossos.dataset_layers where _dataSet = $dataSetId and name not in ${SqlToken.tupleFromList(
        dataLayers.map(_.name))}".asUpdate
    val clearQuery = q"delete from webknossos.dataset_layers where _dataSet = $dataSetId".asUpdate

    val queries = source.toUsable match {
      case Some(usable) =>
        getSpecificClearQuery(usable.dataLayers) :: usable.dataLayers.map(insertLayerQuery(dataSetId, _))
      case _ => List(clearQuery)
    }
    for {
      _ <- run(DBIO.sequence(queries))
      _ <- dataSetResolutionsDAO.updateResolutions(dataSetId, source.toUsable.map(_.dataLayers))
    } yield ()
  }

  def updateLayerAdminViewConfiguration(dataSetId: ObjectId,
                                        layerName: String,
                                        adminViewConfiguration: LayerViewConfiguration): Fox[Unit] =
    for {
      _ <- run(q"""update webknossos.dataset_layers
                   set adminViewConfiguration = ${Json.toJson(adminViewConfiguration)}
                   where _dataSet = $dataSetId and name = $layerName""".asUpdate)
    } yield ()
}

class DataSetLastUsedTimesDAO @Inject()(sqlClient: SqlClient)(implicit ec: ExecutionContext)
    extends SimpleSQLDAO(sqlClient) {
  def findForDataSetAndUser(dataSetId: ObjectId, userId: ObjectId): Fox[Instant] =
    for {
      rList <- run(
        q"select lastUsedTime from webknossos.dataSet_lastUsedTimes where _dataSet = $dataSetId and _user = $userId"
          .as[Instant])
      r <- rList.headOption.toFox
    } yield r

  def updateForDataSetAndUser(dataSetId: ObjectId, userId: ObjectId): Fox[Unit] = {
    val clearQuery =
      q"delete from webknossos.dataSet_lastUsedTimes where _dataSet = $dataSetId and _user = $userId".asUpdate
    val insertQuery =
      q"insert into webknossos.dataSet_lastUsedTimes(_dataSet, _user, lastUsedTime) values($dataSetId, $userId, NOW())".asUpdate
    val composedQuery = DBIO.sequence(List(clearQuery, insertQuery))
    for {
      _ <- run(composedQuery.transactionally.withTransactionIsolation(Serializable),
               retryCount = 50,
               retryIfErrorContains = List(transactionSerializationError))
    } yield ()
  }
}
