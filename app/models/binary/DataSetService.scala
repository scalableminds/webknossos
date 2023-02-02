package models.binary

import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.JsonHelper.box2Option
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
import com.scalableminds.webknossos.datastore.storage.TemporaryStore
import com.typesafe.scalalogging.LazyLogging
import models.folder.{FolderDAO, FolderService}

import javax.inject.Inject
import models.job.WorkerDAO
import models.organization.{Organization, OrganizationDAO}
import models.team._
import models.user.{User, UserService}
import net.liftweb.common.{Box, Full}
import oxalis.security.RandomIDGenerator
import play.api.libs.json.{JsObject, Json}
import utils.{ObjectId, WkConf}

import scala.concurrent.{ExecutionContext, Future}

class DataSetService @Inject()(organizationDAO: OrganizationDAO,
                               dataSetDAO: DataSetDAO,
                               dataStoreDAO: DataStoreDAO,
                               dataSetLastUsedTimesDAO: DataSetLastUsedTimesDAO,
                               dataSetDataLayerDAO: DataSetDataLayerDAO,
                               teamDAO: TeamDAO,
                               workerDAO: WorkerDAO,
                               folderDAO: FolderDAO,
                               dataStoreService: DataStoreService,
                               teamService: TeamService,
                               userService: UserService,
                               folderService: FolderService,
                               val thumbnailCache: TemporaryStore[String, Array[Byte]],
                               rpc: RPC,
                               conf: WkConf)(implicit ec: ExecutionContext)
    extends FoxImplicits
    with LazyLogging {
  private val unreportedStatus = dataSetDAO.unreportedStatus
  private val notYetUploadedStatus = "Not yet fully uploaded."
  private val inactiveStatusList = List(unreportedStatus, notYetUploadedStatus)

  def assertValidDataSetName(name: String): Fox[Unit] =
    for {
      _ <- bool2Fox(name.matches("[A-Za-z0-9_\\-\\.]*")) ?~> "dataSet.name.invalid.characters"
      _ <- bool2Fox(!name.startsWith(".")) ?~> "dataSet.name.invalid.startsWithDot"
      _ <- bool2Fox(name.length >= 3) ?~> "dataSet.name.invalid.lessThanThreeCharacters"
    } yield ()

  def assertNewDataSetName(name: String, organizationId: ObjectId): Fox[Unit] =
    dataSetDAO.findOneByNameAndOrganization(name, organizationId)(GlobalAccessContext).reverse

  def createPreliminaryDataset(dataSetName: String, organizationName: String, dataStore: DataStore): Fox[DataSet] = {
    val unreportedDatasource = UnusableDataSource(DataSourceId(dataSetName, organizationName), notYetUploadedStatus)
    createDataSet(dataStore, organizationName, unreportedDatasource)
  }

  def createDataSet(
      dataStore: DataStore,
      owningOrganization: String,
      dataSource: InboxDataSource,
      publication: Option[ObjectId] = None
  ): Fox[DataSet] = {
    implicit val ctx: DBAccessContext = GlobalAccessContext
    val newId = ObjectId.generate
    val details =
      Json.obj("species" -> "species name", "brainRegion" -> "brain region", "acquisition" -> "acquisition method")
    val dataSourceHash = if (dataSource.isUsable) Some(dataSource.hashCode()) else None
    for {
      organization <- organizationDAO.findOneByName(owningOrganization)
      orbanizationRootFolder <- folderDAO.findOne(organization._rootFolder)
      dataSet = DataSet(
        newId,
        dataStore.name,
        organization._id,
        publication,
        None,
        orbanizationRootFolder._id,
        dataSourceHash,
        dataSource.defaultViewConfiguration,
        adminViewConfiguration = None,
        description = None,
        displayName = None,
        isPublic = false,
        isUsable = dataSource.isUsable,
        name = dataSource.id.name,
        scale = dataSource.scaleOpt,
        sharingToken = None,
        status = dataSource.statusOpt.getOrElse(""),
        logoUrl = None,
        details = publication.map(_ => details)
      )
      _ <- dataSetDAO.insertOne(dataSet)
      _ <- dataSetDataLayerDAO.updateLayers(newId, dataSource)
      _ <- teamDAO.updateAllowedTeamsForDataset(newId, List())
    } yield dataSet
  }

  def updateDataSources(dataStore: DataStore, dataSources: List[InboxDataSource])(
      implicit ctx: DBAccessContext): Fox[List[ObjectId]] = {

    val groupedByOrga = dataSources.groupBy(_.id.team).toList
    Fox
      .serialCombined(groupedByOrga) { orgaTuple: (String, List[InboxDataSource]) =>
        organizationDAO
          .findOneByName(orgaTuple._1)
          .futureBox
          .flatMap {
            case Full(organization) if dataStore.onlyAllowedOrganization.exists(_ != organization._id) =>
              logger.info(
                s"Ignoring ${orgaTuple._2.length} reported datasets for forbidden organization ${orgaTuple._1} from organization-specific datastore ${dataStore.name}")
              Fox.successful(List.empty)
            case Full(organization) =>
              for {
                foundDatasets <- dataSetDAO.findAllByNamesAndOrganization(orgaTuple._2.map(_.id.name), organization._id)
                foundDatasetsByName = foundDatasets.groupBy(_.name)
                existingIds <- Fox.serialCombined(orgaTuple._2)(dataSource =>
                  updateDataSource(dataStore, dataSource, foundDatasetsByName))
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
      foundDatasets: Map[String, List[DataSet]]
  )(implicit ctx: DBAccessContext): Fox[Option[ObjectId]] = {
    val foundDataSetOpt = foundDatasets.get(dataSource.id.name).flatMap(_.headOption)
    foundDataSetOpt match {
      case Some(foundDataSet) if foundDataSet._dataStore == dataStore.name =>
        updateKnownDataSource(foundDataSet, dataSource, dataStore).toFox.map(Some(_))
      case Some(foundDataSet) => // This only returns None for Datasets that are present on a normal Datastore but also got reported from a scratch Datastore
        updateDataSourceDifferentDataStore(foundDataSet, dataSource, dataStore)
      case _ =>
        insertNewDataSet(dataSource, dataStore).toFox.map(Some(_))
    }
  }

  private def updateKnownDataSource(foundDataSet: DataSet, dataSource: InboxDataSource, dataStore: DataStore)(
      implicit ctx: DBAccessContext): Future[Box[ObjectId]] =
    if (foundDataSet.inboxSourceHash.contains(dataSource.hashCode))
      Fox.successful(foundDataSet._id)
    else
      for {
        _ <- dataSetDAO.updateDataSourceByNameAndOrganizationName(foundDataSet._id,
                                                                  dataStore.name,
                                                                  dataSource.hashCode,
                                                                  dataSource,
                                                                  dataSource.isUsable)
      } yield foundDataSet._id

  private def updateDataSourceDifferentDataStore(
      foundDataSet: DataSet,
      dataSource: InboxDataSource,
      dataStore: DataStore)(implicit ctx: DBAccessContext): Future[Box[Option[ObjectId]]] =
    // The dataSet is already present (belonging to the same organization), but reported from a different datastore
    (for {
      originalDataStore <- dataStoreDAO.findOneByName(foundDataSet._dataStore)
    } yield {
      if (originalDataStore.isScratch && !dataStore.isScratch || isUnreported(foundDataSet)) {
        logger.info(
          s"Replacing dataset ${foundDataSet.name} (status: ${foundDataSet.status}) from datastore ${originalDataStore.name} by the one from ${dataStore.name}"
        )
        for {
          _ <- dataSetDAO.updateDataSourceByNameAndOrganizationName(foundDataSet._id,
                                                                    dataStore.name,
                                                                    dataSource.hashCode,
                                                                    dataSource,
                                                                    dataSource.isUsable)(GlobalAccessContext)
        } yield Some(foundDataSet._id)
      } else {
        logger.info(
          s"Dataset ${foundDataSet.name}, as reported from ${dataStore.name} is already present from datastore ${originalDataStore.name} and will not be replaced.")
        Fox.successful(None)
      }
    }).flatten.futureBox

  private def insertNewDataSet(dataSource: InboxDataSource, dataStore: DataStore) =
    publicationForFirstDataset.flatMap { publicationId: Option[ObjectId] =>
      createDataSet(dataStore, dataSource.id.team, dataSource, publicationId).map(_._id)
    }.futureBox

  private def publicationForFirstDataset: Fox[Option[ObjectId]] =
    if (conf.WebKnossos.SampleOrganization.enabled) {
      dataSetDAO.isEmpty.map { isEmpty =>
        if (isEmpty)
          Some(ObjectId("5c766bec6c01006c018c7459"))
        else
          None
      }
    } else Fox.successful(None)

  def deactivateUnreportedDataSources(existingDataSetIds: List[ObjectId], dataStore: DataStore): Fox[Unit] =
    dataSetDAO.deactivateUnreported(existingDataSetIds, dataStore.name, unreportedStatus, inactiveStatusList)

  def getSharingToken(dataSetName: String, organizationId: ObjectId)(implicit ctx: DBAccessContext): Fox[String] = {

    def createAndSaveSharingToken(dataSetName: String)(implicit ctx: DBAccessContext): Fox[String] =
      for {
        tokenValue <- new RandomIDGenerator().generate
        _ <- dataSetDAO.updateSharingTokenByName(dataSetName, organizationId, Some(tokenValue))
      } yield tokenValue

    dataSetDAO.getSharingTokenByName(dataSetName, organizationId).flatMap {
      case Some(oldToken) => Fox.successful(oldToken)
      case None           => createAndSaveSharingToken(dataSetName)
    }
  }

  def dataSourceFor(dataSet: DataSet,
                    organization: Option[Organization] = None,
                    skipResolutions: Boolean = false): Fox[InboxDataSource] =
    (for {
      organization <- Fox.fillOption(organization) {
        organizationDAO.findOne(dataSet._organization)(GlobalAccessContext) ?~> "organization.notFound"
      }
      dataLayers <- dataSetDataLayerDAO.findAllForDataSet(dataSet._id, skipResolutions)
      dataSourceId = DataSourceId(dataSet.name, organization.name)
    } yield {
      if (dataSet.isUsable)
        for {
          scale <- dataSet.scale.toFox ?~> "dataSet.source.usableButNoScale"
        } yield GenericDataSource[DataLayer](dataSourceId, dataLayers, scale)
      else
        Fox.successful(UnusableDataSource[DataLayer](dataSourceId, dataSet.status, dataSet.scale))
    }).flatten

  def logoUrlFor(dataSet: DataSet, organization: Option[Organization]): Fox[String] =
    dataSet.logoUrl match {
      case Some(url) => Fox.successful(url)
      case None =>
        Fox.fillOption(organization)(organizationDAO.findOne(dataSet._organization)(GlobalAccessContext)).map(_.logoUrl)
    }

  def dataStoreFor(dataSet: DataSet)(implicit ctx: DBAccessContext): Fox[DataStore] =
    dataStoreDAO.findOneByName(dataSet._dataStore.trim) ?~> "datastore.notFound"

  def clientFor(dataSet: DataSet)(implicit ctx: DBAccessContext): Fox[WKRemoteDataStoreClient] =
    for {
      dataStore <- dataStoreFor(dataSet)
    } yield new WKRemoteDataStoreClient(dataStore, rpc)

  def lastUsedTimeFor(_dataSet: ObjectId, userOpt: Option[User]): Fox[Instant] =
    userOpt match {
      case Some(user) =>
        (for {
          lastUsedTime <- dataSetLastUsedTimesDAO.findForDataSetAndUser(_dataSet, user._id).futureBox
        } yield lastUsedTime.toOption.getOrElse(Instant.zero)).toFox
      case _ => Fox.successful(Instant.zero)
    }

  def allLayersFor(dataSet: DataSet): Fox[List[DataLayer]] =
    for {
      dataSource <- dataSourceFor(dataSet)
      dataSetLayers = dataSource.toUsable.map(d => d.dataLayers).getOrElse(List())
    } yield dataSetLayers

  def isEditableBy(dataSet: DataSet,
                   userOpt: Option[User],
                   userTeamManagerMemberships: Option[List[TeamMembership]] = None): Fox[Boolean] =
    userOpt match {
      case Some(user) =>
        for {
          dataSetAllowedTeams <- teamService.allowedTeamIdsForDataset(dataSet, cumulative = true)
          teamManagerMemberships <- Fox.fillOption(userTeamManagerMemberships)(
            userService.teamManagerMembershipsFor(user._id))
        } yield
          (user.isAdminOf(dataSet._organization)
            || user.isDatasetManager
            || dataSet._uploader.contains(user._id)
            || teamManagerMemberships.map(_.teamId).intersect(dataSetAllowedTeams).nonEmpty)
      case _ => Fox.successful(false)
    }

  def isUnreported(dataSet: DataSet): Boolean = dataSet.status == unreportedStatus

  def addInitialTeams(dataSet: DataSet, teams: List[String])(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      previousDatasetTeams <- teamService.allowedTeamIdsForDataset(dataSet, cumulative = false) ?~> "allowedTeams.notFound"
      _ <- bool2Fox(previousDatasetTeams.isEmpty) ?~> "dataSet.initialTeams.teamsNotEmpty"
      userTeams <- teamDAO.findAllEditable
      userTeamIds = userTeams.map(_._id)
      teamIdsValidated <- Fox.serialCombined(teams)(ObjectId.fromString(_))
      _ <- bool2Fox(teamIdsValidated.forall(team => userTeamIds.contains(team))) ?~> "dataset.initialTeams.invalidTeams"
      _ <- dataSetDAO.assertUpdateAccess(dataSet._id) ?~> "dataset.initialTeams.forbidden"
      _ <- teamDAO.updateAllowedTeamsForDataset(dataSet._id, teamIdsValidated)
    } yield ()

  def addUploader(dataSet: DataSet, _uploader: ObjectId)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- bool2Fox(dataSet._uploader.isEmpty) ?~> "dataSet.uploader.notEmpty"
      _ <- dataSetDAO.updateUploader(dataSet._id, Some(_uploader)) ?~> "dataset.uploader.forbidden"
    } yield ()

  def publicWrites(dataSet: DataSet,
                   requestingUserOpt: Option[User],
                   organization: Option[Organization],
                   dataStore: Option[DataStore],
                   skipResolutions: Boolean = false,
                   requestingUserTeamManagerMemberships: Option[List[TeamMembership]] = None)(
      implicit ctx: DBAccessContext): Fox[JsObject] =
    for {
      organization <- Fox.fillOption(organization) {
        organizationDAO.findOne(dataSet._organization) ?~> "organization.notFound"
      }
      dataStore <- Fox.fillOption(dataStore) {
        dataStoreFor(dataSet)
      }
      teams <- teamService.allowedTeamsForDataset(dataSet, cumulative = false, requestingUserOpt) ?~> "dataset.list.fetchAllowedTeamsFailed"
      teamsJs <- Fox.serialCombined(teams)(t => teamService.publicWrites(t, Some(organization))) ?~> "dataset.list.teamWritesFailed"
      teamsCumulative <- teamService.allowedTeamsForDataset(dataSet, cumulative = true, requestingUserOpt) ?~> "dataset.list.fetchAllowedTeamsFailed"
      teamsCumulativeJs <- Fox.serialCombined(teamsCumulative)(t => teamService.publicWrites(t, Some(organization))) ?~> "dataset.list.teamWritesFailed"
      logoUrl <- logoUrlFor(dataSet, Some(organization)) ?~> "dataset.list.fetchLogoUrlFailed"
      isEditable <- isEditableBy(dataSet, requestingUserOpt, requestingUserTeamManagerMemberships) ?~> "dataset.list.isEditableCheckFailed"
      lastUsedByUser <- lastUsedTimeFor(dataSet._id, requestingUserOpt) ?~> "dataset.list.fetchLastUsedTimeFailed"
      dataStoreJs <- dataStoreService.publicWrites(dataStore) ?~> "dataset.list.dataStoreWritesFailed"
      dataSource <- dataSourceFor(dataSet, Some(organization), skipResolutions) ?~> "dataset.list.fetchDataSourceFailed"
      worker <- workerDAO.findOneByDataStore(dataStore.name).futureBox
      jobsEnabled = conf.Features.jobsEnabled && worker.nonEmpty
    } yield {
      Json.obj(
        "name" -> dataSet.name,
        "dataSource" -> dataSource,
        "dataStore" -> dataStoreJs,
        "owningOrganization" -> organization.name,
        "allowedTeams" -> teamsJs,
        "allowedTeamsCumulative" -> teamsCumulativeJs,
        "isActive" -> dataSet.isUsable,
        "isPublic" -> dataSet.isPublic,
        "description" -> dataSet.description,
        "displayName" -> dataSet.displayName,
        "created" -> dataSet.created,
        "isEditable" -> isEditable,
        "lastUsedByUser" -> lastUsedByUser,
        "logoUrl" -> logoUrl,
        "sortingKey" -> dataSet.sortingKey,
        "details" -> dataSet.details,
        "isUnreported" -> Json.toJson(isUnreported(dataSet)),
        "jobsEnabled" -> jobsEnabled,
        "tags" -> dataSet.tags,
        "folderId" -> dataSet._folder,
        // included temporarily for compatibility with webknossos-libs, until a better versioning mechanism is implemented
        "publication" -> None
      )
    }
}
