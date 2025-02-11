package models.dataset

import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.models.datasource.inbox.{
  UnusableDataSource,
  InboxDataSourceLike => InboxDataSource
}
import com.scalableminds.webknossos.datastore.models.datasource.{
  DataSourceId,
  GenericDataSource,
  DataLayerLike => DataLayer
}
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.typesafe.scalalogging.LazyLogging
import models.folder.FolderDAO
import models.organization.{Organization, OrganizationDAO}
import models.team._
import models.user.{User, UserService}
import com.scalableminds.util.tools.{Box, Full}
import play.api.libs.json.{JsObject, Json}
import security.RandomIDGenerator
import utils.WkConf

import javax.inject.Inject
import scala.concurrent.duration._
import scala.concurrent.{ExecutionContext, Future}

class DatasetService @Inject()(organizationDAO: OrganizationDAO,
                               datasetDAO: DatasetDAO,
                               dataStoreDAO: DataStoreDAO,
                               datasetLastUsedTimesDAO: DatasetLastUsedTimesDAO,
                               datasetDataLayerDAO: DatasetLayerDAO,
                               teamDAO: TeamDAO,
                               folderDAO: FolderDAO,
                               dataStoreService: DataStoreService,
                               teamService: TeamService,
                               thumbnailCachingService: ThumbnailCachingService,
                               userService: UserService,
                               rpc: RPC,
                               conf: WkConf)(implicit ec: ExecutionContext)
    extends FoxImplicits
    with LazyLogging {
  private val unreportedStatus = datasetDAO.unreportedStatus
  private val notYetUploadedStatus = "Not yet fully uploaded."
  private val inactiveStatusList = List(unreportedStatus, notYetUploadedStatus, datasetDAO.deletedByUserStatus)

  def assertValidDatasetName(name: String): Fox[Unit] =
    for {
      _ <- bool2Fox(name.matches("[A-Za-z0-9_\\-\\.]*")) ?~> "dataset.name.invalid.characters"
      _ <- bool2Fox(!name.startsWith(".")) ?~> "dataset.name.invalid.startsWithDot"
      _ <- bool2Fox(name.length >= 3) ?~> "dataset.name.invalid.lessThanThreeCharacters"
    } yield ()

  // Less strict variant than what we want for https://github.com/scalableminds/webknossos/issues/7711
  // since some existing layer names don’t fulfill the new strict criteria
  // but we don’t want to disable features for those now
  def assertValidLayerNameLax(name: String): Fox[Unit] =
    for {
      _ <- bool2Fox(!name.contains("/")) ?~> "dataset.layer.name.invalid.characters"
      _ <- bool2Fox(!name.startsWith(".")) ?~> "dataset.layer.name.invalid.startsWithDot"
    } yield ()

  def createPreliminaryDataset(datasetName: String, organizationId: String, dataStore: DataStore): Fox[Dataset] = {
    val newDatasetId = ObjectId.generate
    for {
      datasetDirectoryName <- datasetDAO
        .doesDatasetDirectoryExistInOrganization(datasetName, organizationId)(GlobalAccessContext)
        .map(if (_) s"$datasetName-${newDatasetId.toString}" else datasetName)
      unreportedDatasource = UnusableDataSource(DataSourceId(datasetDirectoryName, organizationId),
                                                notYetUploadedStatus)
      newDataset <- createDataset(dataStore, newDatasetId, datasetName, unreportedDatasource)
    } yield newDataset
  }

  def getAllUnfinishedDatasetUploadsOfUser(userId: ObjectId, organizationId: String)(
      implicit ctx: DBAccessContext): Fox[List[DatasetCompactInfo]] =
    datasetDAO.findAllCompactWithSearch(
      uploaderIdOpt = Some(userId),
      organizationIdOpt = Some(organizationId),
      isActiveOpt = Some(false),
      includeSubfolders = true,
      statusOpt = Some(notYetUploadedStatus),
      // Only list pending uploads since the two last weeks.
      createdSinceOpt = Some(Instant.now - (14 days))
    ) ?~> "dataset.list.fetchFailed"

  private def createDataset(
      dataStore: DataStore,
      datasetId: ObjectId,
      datasetName: String,
      dataSource: InboxDataSource,
      publication: Option[ObjectId] = None
  ): Fox[Dataset] = {
    implicit val ctx: DBAccessContext = GlobalAccessContext
    val metadata =
      if (publication.isDefined)
        Json.arr(
          Json.obj("type" -> "string", "key" -> "species", "value" -> "species name"),
          Json.obj("type" -> "string", "key" -> "brainRegion", "value" -> "brain region"),
          Json.obj("type" -> "string", "key" -> "acquisition", "value" -> "acquisition method")
        )
      else Json.arr()

    val dataSourceHash = if (dataSource.isUsable) Some(dataSource.hashCode()) else None
    for {
      organization <- organizationDAO.findOne(dataSource.id.organizationId)
      organizationRootFolder <- folderDAO.findOne(organization._rootFolder)
      dataset = Dataset(
        datasetId,
        dataStore.name,
        organization._id,
        publication,
        None,
        organizationRootFolder._id,
        dataSourceHash,
        dataSource.defaultViewConfiguration,
        adminViewConfiguration = None,
        description = None,
        directoryName = dataSource.id.directoryName,
        isPublic = false,
        isUsable = dataSource.isUsable,
        name = datasetName,
        voxelSize = dataSource.voxelSizeOpt,
        sharingToken = None,
        status = dataSource.statusOpt.getOrElse(""),
        logoUrl = None,
        metadata = metadata
      )
      _ <- datasetDAO.insertOne(dataset)
      _ <- datasetDataLayerDAO.updateLayers(datasetId, dataSource)
      _ <- teamDAO.updateAllowedTeamsForDataset(datasetId, List())
    } yield dataset
  }

  def updateDataSources(dataStore: DataStore, dataSources: List[InboxDataSource])(
      implicit ctx: DBAccessContext): Fox[List[ObjectId]] = {

    val groupedByOrga = dataSources.groupBy(_.id.organizationId).toList
    Fox
      .serialCombined(groupedByOrga) { ((orgaTuple: (String, List[InboxDataSource]))) =>
        organizationDAO
          .findOne(orgaTuple._1)
          .futureBox
          .flatMap {
            case Full(organization) if dataStore.onlyAllowedOrganization.exists(_ != organization._id) =>
              logger.info(
                s"Ignoring ${orgaTuple._2.length} reported datasets for forbidden organization ${orgaTuple._1} from organization-specific datastore ${dataStore.name}")
              Fox.successful(List.empty)
            case Full(organization) =>
              for {
                foundDatasets <- datasetDAO.findAllByDirectoryNamesAndOrganization(orgaTuple._2.map(_.id.directoryName),
                                                                                   organization._id)
                foundDatasetsByDirectoryName = foundDatasets.groupBy(_.directoryName)
                existingIds <- Fox.serialCombined(orgaTuple._2)(dataSource =>
                  updateDataSource(dataStore, dataSource, foundDatasetsByDirectoryName))
              } yield existingIds.flatten
            case _ =>
              logger.info(
                s"Ignoring ${orgaTuple._2.length} reported datasets for non-existing organization ${orgaTuple._1}")
              Fox.successful(List.empty)
          }
          .toFox
      }
      .map(_.flatten)
  }

  private def updateDataSource(
      dataStore: DataStore,
      dataSource: InboxDataSource,
      foundDatasetsByDirectoryName: Map[String, List[Dataset]]
  )(implicit ctx: DBAccessContext): Fox[Option[ObjectId]] = {
    val foundDatasetOpt = foundDatasetsByDirectoryName.get(dataSource.id.directoryName).flatMap(_.headOption)
    foundDatasetOpt match {
      case Some(foundDataset) if foundDataset._dataStore == dataStore.name =>
        updateKnownDataSource(foundDataset, dataSource, dataStore).toFox.map(Some(_))
      case Some(foundDataset) => // This only returns None for Datasets that are present on a normal Datastore but also got reported from a scratch Datastore
        updateDataSourceDifferentDataStore(foundDataset, dataSource, dataStore)
      case _ =>
        insertNewDataset(dataSource, dataSource.id.directoryName, dataStore).toFox.map(Some(_))
    }
  }

  private def updateKnownDataSource(foundDataset: Dataset, dataSource: InboxDataSource, dataStore: DataStore)(
      implicit ctx: DBAccessContext): Future[Box[ObjectId]] =
    if (foundDataset.inboxSourceHash.contains(dataSource.hashCode))
      Fox.successful(foundDataset._id)
    else
      for {
        _ <- thumbnailCachingService.removeFromCache(foundDataset._id)
        _ <- datasetDAO.updateDataSourceByDatasetId(foundDataset._id,
                                                    dataStore.name,
                                                    dataSource.hashCode,
                                                    dataSource,
                                                    dataSource.isUsable)
      } yield foundDataset._id

  private def updateDataSourceDifferentDataStore(
      foundDataset: Dataset,
      dataSource: InboxDataSource,
      dataStore: DataStore)(implicit ctx: DBAccessContext): Future[Box[Option[ObjectId]]] =
    // The dataset is already present (belonging to the same organization), but reported from a different datastore
    (for {
      originalDataStore <- dataStoreDAO.findOneByName(foundDataset._dataStore)
    } yield {
      if (originalDataStore.isScratch && !dataStore.isScratch || isUnreported(foundDataset)) {
        logger.info(
          s"Replacing dataset ${foundDataset.name} (with id ${foundDataset._id} and status: ${foundDataset.status}) from datastore ${originalDataStore.name} by the one from ${dataStore.name}"
        )
        for {
          _ <- thumbnailCachingService.removeFromCache(foundDataset._id)
          _ <- datasetDAO.updateDataSourceByDatasetId(foundDataset._id,
                                                      dataStore.name,
                                                      dataSource.hashCode,
                                                      dataSource,
                                                      dataSource.isUsable)(GlobalAccessContext)
        } yield Some(foundDataset._id)
      } else {
        logger.info(
          s"Dataset ${foundDataset.name}, as reported from ${dataStore.name}, is already present as id ${foundDataset._id} from datastore ${originalDataStore.name} and will not be replaced.")
        Fox.successful(None)
      }
    }).flatten.futureBox

  private def insertNewDataset(dataSource: InboxDataSource, datasetName: String, dataStore: DataStore) =
    publicationForFirstDataset.flatMap { ((publicationId: Option[ObjectId])) =>
      createDataset(dataStore, ObjectId.generate, datasetName, dataSource, publicationId).map(_._id)
    }.futureBox

  private def publicationForFirstDataset: Fox[Option[ObjectId]] =
    if (conf.WebKnossos.SampleOrganization.enabled) {
      datasetDAO.isEmpty.map { isEmpty =>
        if (isEmpty)
          Some(ObjectId("5c766bec6c01006c018c7459"))
        else
          None
      }
    } else Fox.successful(None)

  def deactivateUnreportedDataSources(existingDatasetIds: List[ObjectId], dataStore: DataStore): Fox[Unit] =
    datasetDAO.deactivateUnreported(existingDatasetIds, dataStore.name, unreportedStatus, inactiveStatusList)

  def getSharingToken(datasetId: ObjectId)(implicit ctx: DBAccessContext): Fox[String] = {

    def createAndSaveSharingToken(datasetId: ObjectId)(implicit ctx: DBAccessContext): Fox[String] =
      for {
        tokenValue <- new RandomIDGenerator().generate
        _ <- datasetDAO.updateSharingTokenById(datasetId, Some(tokenValue))
      } yield tokenValue

    datasetDAO.getSharingTokenById(datasetId).flatMap {
      case Some(oldToken) => Fox.successful(oldToken)
      case None           => createAndSaveSharingToken(datasetId)
    }
  }

  def dataSourceFor(dataset: Dataset, organization: Option[Organization] = None): Fox[InboxDataSource] =
    (for {
      organization <- Fox.fillOption(organization) {
        organizationDAO.findOne(dataset._organization)(GlobalAccessContext) ?~> "organization.notFound"
      }
      dataLayers <- datasetDataLayerDAO.findAllForDataset(dataset._id)
      dataSourceId = DataSourceId(dataset.directoryName, organization._id)
    } yield {
      if (dataset.isUsable)
        for {
          scale <- dataset.voxelSize.toFox ?~> "dataset.source.usableButNoScale"
        } yield GenericDataSource[DataLayer](dataSourceId, dataLayers, scale)
      else
        Fox.successful(UnusableDataSource[DataLayer](dataSourceId, dataset.status, dataset.voxelSize))
    }).flatten

  private def logoUrlFor(dataset: Dataset, organization: Option[Organization]): Fox[String] =
    dataset.logoUrl match {
      case Some(url) => Fox.successful(url)
      case None =>
        Fox.fillOption(organization)(organizationDAO.findOne(dataset._organization)(GlobalAccessContext)).map(_.logoUrl)
    }

  def dataStoreFor(dataset: Dataset)(implicit ctx: DBAccessContext): Fox[DataStore] =
    dataStoreDAO.findOneByName(dataset._dataStore.trim) ?~> "datastore.notFound"

  def clientFor(dataset: Dataset)(implicit ctx: DBAccessContext): Fox[WKRemoteDataStoreClient] =
    for {
      dataStore <- dataStoreFor(dataset)
    } yield new WKRemoteDataStoreClient(dataStore, rpc)

  private def lastUsedTimeFor(datasetId: ObjectId, userOpt: Option[User]): Fox[Instant] =
    userOpt match {
      case Some(user) =>
        (for {
          lastUsedTime <- datasetLastUsedTimesDAO.findForDatasetAndUser(datasetId, user._id).futureBox
        } yield lastUsedTime.toOption.getOrElse(Instant.zero)).toFox
      case _ => Fox.successful(Instant.zero)
    }

  def allLayersFor(dataset: Dataset): Fox[List[DataLayer]] =
    for {
      dataSource <- dataSourceFor(dataset)
      datasetLayers = dataSource.toUsable.map(d => d.dataLayers).getOrElse(List())
    } yield datasetLayers

  def isEditableBy(dataset: Dataset,
                   userOpt: Option[User],
                   userTeamManagerMemberships: Option[List[TeamMembership]] = None): Fox[Boolean] =
    userOpt match {
      case Some(user) =>
        for {
          datasetAllowedTeams <- teamService.allowedTeamIdsForDataset(dataset, cumulative = true)
          teamManagerMemberships <- Fox.fillOption(userTeamManagerMemberships)(
            userService.teamManagerMembershipsFor(user._id))
        } yield
          (user.isAdminOf(dataset._organization)
            || user.isDatasetManager
            || teamManagerMemberships.map(_.teamId).intersect(datasetAllowedTeams).nonEmpty)
      case _ => Fox.successful(false)
    }

  def isUnreported(dataset: Dataset): Boolean = dataset.status == unreportedStatus

  def addInitialTeams(dataset: Dataset, teams: List[String], user: User)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      previousDatasetTeams <- teamService.allowedTeamIdsForDataset(dataset, cumulative = false) ?~> "allowedTeams.notFound"
      _ <- bool2Fox(previousDatasetTeams.isEmpty) ?~> "dataset.initialTeams.teamsNotEmpty"
      includeMemberOnlyTeams = user.isDatasetManager
      userTeams <- if (includeMemberOnlyTeams) teamDAO.findAll else teamDAO.findAllEditable
      teamIdsValidated <- Fox.serialCombined(teams)(ObjectId.fromString(_))
      _ <- bool2Fox(teamIdsValidated.forall(team => userTeams.map(_._id).contains(team))) ?~> "dataset.initialTeams.invalidTeams"
      _ <- datasetDAO.assertUpdateAccess(dataset._id) ?~> "dataset.initialTeams.forbidden"
      _ <- teamDAO.updateAllowedTeamsForDataset(dataset._id, teamIdsValidated)
    } yield ()

  def addUploader(dataset: Dataset, _uploader: ObjectId)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- bool2Fox(dataset._uploader.isEmpty) ?~> "dataset.uploader.notEmpty"
      _ <- datasetDAO.updateUploader(dataset._id, Some(_uploader)) ?~> "dataset.uploader.forbidden"
    } yield ()

  def publicWrites(dataset: Dataset,
                   requestingUserOpt: Option[User],
                   organization: Option[Organization] = None,
                   dataStore: Option[DataStore] = None,
                   requestingUserTeamManagerMemberships: Option[List[TeamMembership]] = None)(
      implicit ctx: DBAccessContext): Fox[JsObject] =
    for {
      organization <- Fox.fillOption(organization) {
        organizationDAO.findOne(dataset._organization) ?~> "organization.notFound"
      }
      dataStore <- Fox.fillOption(dataStore) {
        dataStoreFor(dataset) ?~> "dataStore.notFound"
      }
      teams <- teamService.allowedTeamsForDataset(dataset, cumulative = false, requestingUserOpt) ?~> "dataset.list.fetchAllowedTeamsFailed"
      teamsJs <- Fox.serialCombined(teams)(t => teamService.publicWrites(t, Some(organization))) ?~> "dataset.list.teamWritesFailed"
      teamsCumulative <- teamService.allowedTeamsForDataset(dataset, cumulative = true, requestingUserOpt) ?~> "dataset.list.fetchAllowedTeamsFailed"
      teamsCumulativeJs <- Fox.serialCombined(teamsCumulative)(t => teamService.publicWrites(t, Some(organization))) ?~> "dataset.list.teamWritesFailed"
      logoUrl <- logoUrlFor(dataset, Some(organization)) ?~> "dataset.list.fetchLogoUrlFailed"
      isEditable <- isEditableBy(dataset, requestingUserOpt, requestingUserTeamManagerMemberships) ?~> "dataset.list.isEditableCheckFailed"
      lastUsedByUser <- lastUsedTimeFor(dataset._id, requestingUserOpt) ?~> "dataset.list.fetchLastUsedTimeFailed"
      dataStoreJs <- dataStoreService.publicWrites(dataStore) ?~> "dataset.list.dataStoreWritesFailed"
      dataSource <- dataSourceFor(dataset, Some(organization)) ?~> "dataset.list.fetchDataSourceFailed"
      usedStorageBytes <- Fox.runIf(requestingUserOpt.exists(u => u._organization == dataset._organization))(
        organizationDAO.getUsedStorageForDataset(dataset._id))
    } yield {
      Json.obj(
        "id" -> dataset._id,
        "name" -> dataset.name,
        "dataSource" -> dataSource,
        "dataStore" -> dataStoreJs,
        "owningOrganization" -> organization._id,
        "allowedTeams" -> teamsJs,
        "allowedTeamsCumulative" -> teamsCumulativeJs,
        "isActive" -> dataset.isUsable,
        "isPublic" -> dataset.isPublic,
        "description" -> dataset.description,
        "directoryName" -> dataset.directoryName,
        "created" -> dataset.created,
        "isEditable" -> isEditable,
        "lastUsedByUser" -> lastUsedByUser,
        "logoUrl" -> logoUrl,
        "sortingKey" -> dataset.sortingKey,
        "metadata" -> dataset.metadata,
        "isUnreported" -> Json.toJson(isUnreported(dataset)),
        "tags" -> dataset.tags,
        "folderId" -> dataset._folder,
        // included temporarily for compatibility with webknossos-libs, until a better versioning mechanism is implemented
        "publication" -> None,
        "usedStorageBytes" -> usedStorageBytes
      )
    }
}
