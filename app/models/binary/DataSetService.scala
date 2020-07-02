package models.binary

import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.dataformats.wkw.WKWSegmentationLayer
import com.scalableminds.webknossos.datastore.models.datasource.{
  AbstractSegmentationLayer,
  DataSourceId,
  ElementClass,
  GenericDataSource,
  inbox,
  DataLayerLike => DataLayer
}
import com.scalableminds.webknossos.datastore.models.datasource.inbox.{
  UnusableDataSource,
  InboxDataSourceLike => InboxDataSource
}
import com.scalableminds.webknossos.datastore.storage.TemporaryStore
import com.typesafe.scalalogging.LazyLogging
import javax.inject.Inject
import models.team._
import models.user.{User, UserService}
import net.liftweb.common.{Box, Failure, Full}
import oxalis.security.{CompactRandomIDGenerator, URLSharing}
import play.api.i18n.{Messages, MessagesApi}
import play.api.i18n.Messages.Implicits._
import play.api.libs.json.{JsObject, Json}
import play.api.libs.ws.WSResponse
import utils.{ObjectId, WkConf}

import scala.concurrent.{ExecutionContext, Future}

class DataSetService @Inject()(organizationDAO: OrganizationDAO,
                               dataSetDAO: DataSetDAO,
                               dataStoreDAO: DataStoreDAO,
                               dataSetLastUsedTimesDAO: DataSetLastUsedTimesDAO,
                               dataSetDataLayerDAO: DataSetDataLayerDAO,
                               teamDAO: TeamDAO,
                               publicationDAO: PublicationDAO,
                               publicationService: PublicationService,
                               dataStoreService: DataStoreService,
                               teamService: TeamService,
                               userService: UserService,
                               dataSetAllowedTeamsDAO: DataSetAllowedTeamsDAO,
                               val thumbnailCache: TemporaryStore[String, Array[Byte]],
                               rpc: RPC,
                               conf: WkConf)(implicit ec: ExecutionContext)
    extends FoxImplicits
    with LazyLogging {

  val unreportedStatus = "No longer available on datastore."
  val initialTeamsTimeoutMs: Long = 5 * 60 * 1000

  def isProperDataSetName(name: String): Boolean =
    name.matches("[A-Za-z0-9_\\-]*")

  def assertNewDataSetName(name: String, organizationId: ObjectId)(implicit ctx: DBAccessContext): Fox[Boolean] =
    dataSetDAO.findOneByNameAndOrganization(name, organizationId)(GlobalAccessContext).reverse

  def createDataSet(
      name: String,
      dataStore: DataStore,
      owningOrganization: String,
      dataSource: InboxDataSource,
      publication: Option[ObjectId] = None,
      isActive: Boolean = false
  ): Fox[ObjectId] = {
    implicit val ctx = GlobalAccessContext
    val newId = ObjectId.generate
    val details =
      Json.obj("species" -> "species name", "brainRegion" -> "brain region", "acquisition" -> "acquisition method")
    for {
      organization <- organizationDAO.findOneByName(owningOrganization)
      _ <- dataSetDAO.insertOne(
        DataSet(
          newId,
          dataStore.name,
          organization._id,
          publication,
          Some(dataSource.hashCode()),
          dataSource.defaultViewConfiguration,
          None,
          None,
          None,
          false,
          dataSource.toUsable.isDefined,
          dataSource.id.name,
          dataSource.scaleOpt,
          None,
          dataSource.statusOpt.getOrElse(""),
          None,
          details = publication.map(_ => details)
        ))
      _ <- dataSetDataLayerDAO.updateLayers(newId, dataSource)
      _ <- dataSetAllowedTeamsDAO.updateAllowedTeamsForDataSet(newId, List())
    } yield newId
  }

  def addForeignDataSet(dataStoreName: String, dataSetName: String, organizationName: String)(
      implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      dataStore <- dataStoreDAO.findOneByName(dataStoreName)
      foreignDataset <- getForeignDataSet(dataStore.url, dataSetName)
      _ <- createDataSet(dataSetName, dataStore, organizationName, foreignDataset)
    } yield ()

  def getForeignDataSet(dataStoreUrl: String, dataSetName: String): Fox[InboxDataSource] =
    rpc(s"${dataStoreUrl}/data/datasets/${dataSetName}/readInboxDataSourceLike")
      .addQueryString("token" -> "") // we don't need a valid token because the DataSet is public, but we have to add the parameter token because it is a TokenSecuredAction
      .getWithJsonResponse[InboxDataSource]

  def addForeignDataStore(name: String, url: String)(implicit ctx: DBAccessContext): Fox[Unit] = {
    val dataStore = DataStore(name, url, url, "", isForeign = true, isConnector = false) // the key can be "" because keys are only important for own DataStore. Own Datastores have a key that is not ""
    for {
      _ <- dataStoreDAO.insertOne(dataStore)
    } yield ()
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
                                                                  dataSource.isUsable)(GlobalAccessContext)
        _ <- dataSetDataLayerDAO.updateLayers(foundDataSet._id, dataSource)
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
          _ <- dataSetDataLayerDAO.updateLayers(foundDataSet._id, dataSource)
        } yield Some(foundDataSet._id)
      } else {
        logger.info(
          s"Dataset ${foundDataSet.name}, as reported from ${dataStore.name} is already present from datastore ${originalDataStore.name} and will not be replaced.")
        Fox.successful(None)
      }
    }).flatten.futureBox

  private def insertNewDataSet(dataSource: InboxDataSource, dataStore: DataStore) =
    publicationForFirstDataset.flatMap { publicationId: Option[ObjectId] =>
      createDataSet(dataSource.id.name, dataStore, dataSource.id.team, dataSource, publicationId, dataSource.isUsable)
    }.futureBox

  private def publicationForFirstDataset: Fox[Option[ObjectId]] =
    if (conf.Application.insertInitialData) {
      dataSetDAO.isEmpty(GlobalAccessContext).map { isEmpty =>
        if (isEmpty)
          Some(ObjectId("5c766bec6c01006c018c7459"))
        else
          None
      }
    } else Fox.successful(None)

  def deactivateUnreportedDataSources(existingDataSetIds: List[ObjectId], dataStore: DataStore)(
      implicit ctx: DBAccessContext): Fox[Unit] =
    dataSetDAO.deactivateUnreported(existingDataSetIds, dataStore.name, unreportedStatus)

  def getSharingToken(dataSetName: String, organizationId: ObjectId)(implicit ctx: DBAccessContext) = {

    def createSharingToken(dataSetName: String)(implicit ctx: DBAccessContext) =
      for {
        tokenValue <- new CompactRandomIDGenerator().generate
        _ <- dataSetDAO.updateSharingTokenByName(dataSetName, organizationId, Some(tokenValue))
      } yield tokenValue

    val tokenFoxOfFox: Fox[Fox[String]] = dataSetDAO.getSharingTokenByName(dataSetName, organizationId).map {
      case Some(oldToken) => Fox.successful(oldToken)
      case None           => createSharingToken(dataSetName)
    }

    for {
      tokenFox <- tokenFoxOfFox
      token <- tokenFox
    } yield token
  }

  def dataSourceFor(dataSet: DataSet, organization: Option[Organization] = None, skipResolutions: Boolean = false)(
      implicit ctx: DBAccessContext): Fox[InboxDataSource] =
    for {
      organization <- Fox.fillOption(organization) {
        organizationDAO.findOne(dataSet._organization)(GlobalAccessContext) ?~> "organization.notFound"
      }
      dataLayersBox <- dataSetDataLayerDAO.findAllForDataSet(dataSet._id, skipResolutions).futureBox
      dataSourceId = DataSourceId(dataSet.name, organization.name)
    } yield {
      dataLayersBox match {
        case Full(dataLayers) if (dataLayers.nonEmpty) =>
          for {
            scale <- dataSet.scale
          } yield GenericDataSource[DataLayer](dataSourceId, dataLayers, scale)
        case _ =>
          Some(UnusableDataSource[DataLayer](dataSourceId, dataSet.status, dataSet.scale))
      }
    }

  def logoUrlFor(dataSet: DataSet, organization: Option[Organization]): Fox[String] =
    dataSet.logoUrl match {
      case Some(url) => Fox.successful(url)
      case None =>
        Fox.fillOption(organization)(organizationDAO.findOne(dataSet._organization)(GlobalAccessContext)).map(_.logoUrl)
    }

  def dataStoreFor(dataSet: DataSet): Fox[DataStore] =
    dataStoreDAO.findOneByName(dataSet._dataStore.trim)(GlobalAccessContext) ?~> "datastore.notFound"

  def clientFor(dataSet: DataSet)(implicit ctx: DBAccessContext): Fox[DataStoreRpcClient] =
    for {
      dataStore <- dataStoreFor(dataSet)
    } yield new DataStoreRpcClient(dataStore, dataSet, rpc)

  def lastUsedTimeFor(_dataSet: ObjectId, userOpt: Option[User])(implicit ctx: DBAccessContext): Fox[Long] =
    userOpt match {
      case Some(user) =>
        (for {
          lastUsedTime <- dataSetLastUsedTimesDAO.findForDataSetAndUser(_dataSet, user._id).futureBox
        } yield lastUsedTime.toOption.getOrElse(0L)).toFox
      case _ => Fox.successful(0L)
    }

  def allowedTeamIdsFor(_dataSet: ObjectId)(implicit ctx: DBAccessContext): Fox[List[ObjectId]] =
    dataSetAllowedTeamsDAO.findAllForDataSet(_dataSet) ?~> "allowedTeams.notFound"

  def allowedTeamsFor(_dataSet: ObjectId, requestingUser: Option[User])(
      implicit ctx: DBAccessContext): Fox[List[Team]] =
    for {
      teams <- teamDAO.findAllForDataSet(_dataSet) ?~> "allowedTeams.notFound"
      // dont leak team names of other organizations
      teamsFiltered = teams.filter(team => requestingUser.map(_._organization).contains(team._organization))
    } yield teamsFiltered

  def isEditableBy(
      dataSet: DataSet,
      userOpt: Option[User],
      userTeamManagerMemberships: Option[List[TeamMembership]] = None)(implicit ctx: DBAccessContext): Fox[Boolean] =
    userOpt match {
      case Some(user) =>
        for {
          dataSetAllowedTeams <- dataSetAllowedTeamsDAO.findAllForDataSet(dataSet._id)
          teamManagerMemberships <- Fox.fillOption(userTeamManagerMemberships)(
            userService.teamManagerMembershipsFor(user._id))
        } yield
          (user.isAdminOf(dataSet._organization)
            || user.isDatasetManager
            || teamManagerMemberships.map(_.teamId).intersect(dataSetAllowedTeams).nonEmpty)
      case _ => Fox.successful(false)
    }

  def isUnreported(dataSet: DataSet): Boolean = dataSet.status == unreportedStatus

  def addInitialTeams(dataSet: DataSet, user: User, teams: List[String])(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- bool2Fox(dataSet.created > System.currentTimeMillis() - initialTeamsTimeoutMs) ?~> "dataset.initialTeams.timeout"
      previousDatasetTeams <- allowedTeamIdsFor(dataSet._id)
      _ <- bool2Fox(previousDatasetTeams.isEmpty) ?~> "dataSet.initialTeams.teamsNotEmpty"
      userTeams <- teamDAO.findAllEditable
      userTeamIds = userTeams.map(_._id)
      teamIdsValidated <- Fox.serialCombined(teams)(ObjectId.parse(_))
      _ <- bool2Fox(teamIdsValidated.forall(team => userTeamIds.contains(team))) ?~> "dataset.initialTeams.invalidTeams"
      _ <- dataSetAllowedTeamsDAO.updateAllowedTeamsForDataSet(dataSet._id, teamIdsValidated)
    } yield ()

  def publicWrites(dataSet: DataSet,
                   requestingUserOpt: Option[User],
                   organization: Organization,
                   dataStore: DataStore,
                   skipResolutions: Boolean = false,
                   requestingUserTeamManagerMemberships: Option[List[TeamMembership]] = None)(
      implicit ctx: DBAccessContext): Fox[JsObject] =
    for {
      teams <- allowedTeamsFor(dataSet._id, requestingUserOpt)
      teamsJs <- Fox.serialCombined(teams)(t => teamService.publicWrites(t, Some(organization)))
      logoUrl <- logoUrlFor(dataSet, Some(organization))
      isEditable <- isEditableBy(dataSet, requestingUserOpt, requestingUserTeamManagerMemberships)
      lastUsedByUser <- lastUsedTimeFor(dataSet._id, requestingUserOpt)
      dataStoreJs <- dataStoreService.publicWrites(dataStore)
      dataSource <- dataSourceFor(dataSet, Some(organization), skipResolutions)
      publicationOpt <- Fox.runOptional(dataSet._publication)(publicationDAO.findOne(_))
      publicationJson <- Fox.runOptional(publicationOpt)(publicationService.publicWrites)
    } yield {
      Json.obj(
        "name" -> dataSet.name,
        "dataSource" -> dataSource,
        "dataStore" -> dataStoreJs,
        "owningOrganization" -> organization.name,
        "allowedTeams" -> teamsJs,
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
        "publication" -> publicationJson,
        "isUnreported" -> Json.toJson(isUnreported(dataSet)),
        "isForeign" -> dataStore.isForeign
      )
    }
}
