package models.binary

import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.models.datasource.{
  DataSourceId,
  GenericDataSource,
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
import net.liftweb.common.Full
import oxalis.security.{CompactRandomIDGenerator, URLSharing}
import play.api.i18n.{Messages, MessagesApi}
import play.api.i18n.Messages.Implicits._
import play.api.libs.json.{JsObject, Json}
import play.api.libs.ws.WSResponse
import utils.{ObjectId, WkConf}

import scala.concurrent.ExecutionContext

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
  ) = {
    implicit val ctx = GlobalAccessContext
    val newId = ObjectId.generate
    val details =
      Json.obj("species" -> "species name", "brainRegion" -> "brain region", "acquisition" -> "acquisition method")
    organizationDAO.findOneByName(owningOrganization).futureBox.flatMap {
      case Full(organization) =>
        for {
          _ <- dataSetDAO.insertOne(
            DataSet(
              newId,
              dataStore.name,
              organization._id,
              publication,
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
        } yield ()
      case _ => {
        logger.info(s"Ignoring reported dataset for non-existing organization $owningOrganization")
        Fox.successful(())
      }
    }
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
    val dataStore = DataStore(name, url, "", isForeign = true, isConnector = false) // the key can be "" because keys are only important for own DataStore. Own Datastores have a key that is not ""
    for {
      _ <- dataStoreDAO.insertOne(dataStore)
    } yield ()
  }

  def updateDataSource(
      dataStore: DataStore,
      dataSource: InboxDataSource
  )(implicit ctx: DBAccessContext): Fox[Unit] =
    dataSetDAO
      .findOneByNameAndOrganizationName(dataSource.id.name, dataSource.id.team)(GlobalAccessContext)
      .futureBox
      .flatMap {
        case Full(dataSet) if dataSet._dataStore == dataStore.name =>
          dataSetDAO
            .updateDataSourceByNameAndOrganizationName(dataSource.id.name,
                                                       dataStore.name,
                                                       dataSource,
                                                       dataSource.isUsable)(GlobalAccessContext)
            .futureBox
        case Full(foundDataSet) =>
          // The dataSet is already present (belonging to the same organization), but reported from a different datastore
          (for {
            originalDataStore <- dataStoreDAO.findOneByName(foundDataSet._dataStore)
          } yield {
            if (originalDataStore.isScratch && !dataStore.isScratch) {
              logger.info(
                s"Replacing dataset ${foundDataSet.name} from scratch datastore ${originalDataStore.name} by the one from ${dataStore.name}")
              dataSetDAO.updateDataSourceByNameAndOrganizationName(dataSource.id.name,
                                                                   dataStore.name,
                                                                   dataSource,
                                                                   dataSource.isUsable)(GlobalAccessContext)
            } else {
              logger.info(
                s"Dataset ${foundDataSet.name}, as reported from ${dataStore.name} is already present from datastore ${originalDataStore.name} and will not be replaced.")
              Fox.failure("dataset.name.alreadyInUse")
            }
          }).flatten.futureBox
        case _ =>
          dataSetDAO.findAll(GlobalAccessContext).flatMap { datasets =>
            val publication =
              if (conf.Application.insertInitialData && datasets.isEmpty) Some(ObjectId("5c766bec6c01006c018c7459"))
              else None
            createDataSet(dataSource.id.name,
                          dataStore,
                          dataSource.id.team,
                          dataSource,
                          publication,
                          dataSource.isUsable).futureBox
          }
      }

  def deactivateUnreportedDataSources(dataStoreName: String, dataSources: List[InboxDataSource])(
      implicit ctx: DBAccessContext) = {
    val dataSourcesByOrganizationName: Map[String, List[InboxDataSource]] = dataSources.groupBy(_.id.team)
    Fox.serialCombined(dataSourcesByOrganizationName.keys.toList) { organizationName =>
      for {
        organizationBox <- organizationDAO.findOneByName(organizationName).futureBox
        _ <- organizationBox match {
          case Full(organization) =>
            dataSetDAO.deactivateUnreported(dataSourcesByOrganizationName(organizationName).map(_.id.name),
                                            organization._id,
                                            dataStoreName)
          case _ => {
            logger.info(s"Ignoring reported dataset for non-existing organization $organizationName")
            Fox.successful(())
          }
        }
      } yield ()
    }
  }

  def updateDataSources(dataStore: DataStore, dataSources: List[InboxDataSource])(implicit ctx: DBAccessContext) = {
    logger.info(
      s"[${dataStore.name}] Available datasets: " +
        s"${dataSources.count(_.isUsable)} (usable), ${dataSources.count(!_.isUsable)} (unusable)")
    Fox.serialSequence(dataSources) { dataSource =>
      updateDataSource(dataStore, dataSource)
    }
  }

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
        case Full(dataLayers) if (dataLayers.length > 0) =>
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

  def allowedTeamIdsFor(_dataSet: ObjectId)(implicit ctx: DBAccessContext) =
    dataSetAllowedTeamsDAO.findAllForDataSet(_dataSet)(GlobalAccessContext) ?~> "allowedTeams.notFound"

  def allowedTeamsFor(_dataSet: ObjectId)(implicit ctx: DBAccessContext) =
    teamDAO.findAllForDataSet(_dataSet)(GlobalAccessContext) ?~> "allowedTeams.notFound"

  def isEditableBy(
      dataSet: DataSet,
      userOpt: Option[User],
      userTeamManagerMemberships: Option[List[TeamMembership]] = None)(implicit ctx: DBAccessContext): Fox[Boolean] =
    userOpt match {
      case Some(user) =>
        for {
          isTeamManagerInOrg <- userService.isTeamManagerInOrg(user, dataSet._organization, userTeamManagerMemberships)
        } yield user.isAdminOf(dataSet._organization) || isTeamManagerInOrg
      case _ => Fox.successful(false)
    }

  def publicWrites(dataSet: DataSet,
                   userOpt: Option[User],
                   skipResolutions: Boolean = false,
                   requestingUserTeamManagerMemberships: Option[List[TeamMembership]] = None): Fox[JsObject] = {
    implicit val ctx = GlobalAccessContext
    for {
      organization <- organizationDAO.findOne(dataSet._organization) ?~> "organization.notFound"
      teams <- allowedTeamsFor(dataSet._id)
      teamsJs <- Fox.serialCombined(teams)(t => teamService.publicWrites(t))
      logoUrl <- logoUrlFor(dataSet, Some(organization))
      isEditable <- isEditableBy(dataSet, userOpt, requestingUserTeamManagerMemberships)
      lastUsedByUser <- lastUsedTimeFor(dataSet._id, userOpt)
      dataStore <- dataStoreFor(dataSet)
      dataStoreJs <- dataStoreService.publicWrites(dataStore)
      dataSource <- dataSourceFor(dataSet, Some(organization), skipResolutions)
      publicationOpt <- Fox.runOptional(dataSet._publication)(publicationDAO.findOne(_))
      publicationJson <- Fox.runOptional(publicationOpt)(publicationService.publicWrites(_))
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
        "isForeign" -> dataStore.isForeign
      )
    }
  }

}
