package models.binary

import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.rpc.RPC
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.models.datasource.{DataSourceId, GenericDataSource, DataLayerLike => DataLayer}
import com.scalableminds.webknossos.datastore.models.datasource.inbox.{UnusableDataSource, InboxDataSourceLike => InboxDataSource}
import com.typesafe.scalalogging.LazyLogging
import javax.inject.Inject
import models.team.{OrganizationDAO, TeamDAO, TeamService}
import models.user.{User, UserService}
import net.liftweb.common.Full
import oxalis.security.{CompactRandomIDGenerator, URLSharing}
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.i18n.Messages.Implicits._
import play.api.libs.json.{JsObject, Json}
import play.api.libs.ws.WSResponse
import utils.ObjectId

class DataSetService @Inject()(organizationDAO: OrganizationDAO,
                               dataSetDAO: DataSetDAO,
                               dataStoreDAO: DataStoreDAO,
                               dataSetLastUsedTimesDAO: DataSetLastUsedTimesDAO,
                               dataSetDataLayerDAO: DataSetDataLayerDAO,
                               teamDAO: TeamDAO,
                               dataStoreService: DataStoreService,
                               teamService: TeamService,
                               userService: UserService,
                               dataSetAllowedTeamsDAO: DataSetAllowedTeamsDAO,
                               val messagesApi: MessagesApi
                              ) extends FoxImplicits with LazyLogging {

  def isProperDataSetName(name: String): Boolean =
    name.matches("[A-Za-z0-9_\\-]*")

  def assertNewDataSetName(name: String)(implicit ctx: DBAccessContext): Fox[Boolean] =
    dataSetDAO.findOneByName(name)(GlobalAccessContext).reverse

  def createDataSet(
                     name: String,
                     dataStore: DataStore,
                     owningOrganization: String,
                     dataSource: InboxDataSource,
                     isActive: Boolean = false
                     ) = {
    implicit val ctx = GlobalAccessContext
    val newId = ObjectId.generate
    organizationDAO.findOneByName(owningOrganization).futureBox.flatMap {
      case Full(organization) => for {
        _ <- dataSetDAO.insertOne(DataSet(
                newId,
                dataStore.name,
                organization._id,
                None,
                None,
                None,
                false,
                dataSource.toUsable.isDefined,
                dataSource.id.name,
                dataSource.scaleOpt,
                None,
                dataSource.statusOpt.getOrElse(""),
                None))
        _ <- dataSetDataLayerDAO.updateLayers(newId, dataSource)
        _ <- dataSetAllowedTeamsDAO.updateAllowedTeamsForDataSet(newId, List())
      } yield ()
      case _ => Fox.failure("org.notExist")
    }
  }

  def addForeignDataSet(dataStoreName: String, dataSetName: String, organizationName: String)(implicit ctx: DBAccessContext): Fox[Unit] = {
    for {
      dataStore <- dataStoreDAO.findOneByName(dataStoreName)
      foreignDataset <- getForeignDataSet(dataStore.url, dataSetName)
      _ <- createDataSet(dataSetName, dataStore, organizationName, foreignDataset)
    } yield ()
  }

  def getForeignDataSet(dataStoreUrl: String, dataSetName: String): Fox[InboxDataSource] = {
    RPC(s"${dataStoreUrl}/data/datasets/${dataSetName}/readInboxDataSourceLike")
      .withQueryString("token" -> "") // we don't need a valid token because the DataSet is public, but we have to add the parameter token because it is a TokenSecuredAction
      .getWithJsonResponse[InboxDataSource]
  }

  def addForeignDataStore(name: String, url: String)(implicit ctx: DBAccessContext): Fox[Unit] = {
    val dataStore = DataStore(name, url, "", isForeign = true) // the key can be "" because keys are only important for own DataStore. Own Datastores have a key that is not ""
    for {
      _ <- dataStoreDAO.insertOne(dataStore)
    } yield ()
  }

  def updateDataSource(
                        dataStore: DataStore,
                        dataSource: InboxDataSource
                      )(implicit ctx: DBAccessContext): Fox[Unit] = {

    dataSetDAO.findOneByName(dataSource.id.name)(GlobalAccessContext).futureBox.flatMap {
      case Full(dataSet) if dataSet._dataStore == dataStore.name =>
        dataSetDAO.updateDataSourceByName(
          dataSource.id.name,
          dataStore.name,
          dataSource,
          dataSource.isUsable)(GlobalAccessContext).futureBox
      case Full(_) =>
        // TODO: There is a problem: The dataset name is already in use by some (potentially different) team.
        // We are not going to update that datasource.
        // this should be somehow populated to the user to inform him that he needs to rename the datasource
        Fox.failure("dataset.name.alreadyInUse").futureBox
      case _ =>
        createDataSet(
          dataSource.id.name,
          dataStore,
          dataSource.id.team,
          dataSource,
          isActive = dataSource.isUsable).futureBox
    }
  }

  def deactivateUnreportedDataSources(dataStoreName: String, dataSources: List[InboxDataSource])(implicit ctx: DBAccessContext) =
    dataSetDAO.deactivateUnreported(dataSources.map(_.id.name), dataStoreName)

  def importDataSet(dataSet: DataSet)(implicit ctx: DBAccessContext): Fox[WSResponse] =
    for {
      dataStoreHandler <- handlerFor(dataSet)
      result <- dataStoreHandler.importDataSource
    } yield result

  def updateDataSources(dataStore: DataStore, dataSources: List[InboxDataSource])(implicit ctx: DBAccessContext) = {
    logger.info(s"[${dataStore.name}] Available datasets: " +
      s"${dataSources.count(_.isUsable)} (usable), ${dataSources.count(!_.isUsable)} (unusable)")
    Fox.serialSequence(dataSources) { dataSource =>
      updateDataSource(dataStore, dataSource)
    }
  }

  def getSharingToken(dataSetName: String)(implicit ctx: DBAccessContext) = {

    def createSharingToken(dataSetName: String)(implicit ctx: DBAccessContext) = {
      for {
        tokenValue <- new CompactRandomIDGenerator().generate
        _ <- dataSetDAO.updateSharingTokenByName(dataSetName, Some(tokenValue))
      } yield tokenValue
    }

    val tokenFoxOfFox: Fox[Fox[String]] = dataSetDAO.getSharingTokenByName(dataSetName).map {
      oldTokenOpt => {
        if (oldTokenOpt.isDefined) Fox.successful(oldTokenOpt.get)
        else createSharingToken(dataSetName)
      }
    }

    for {
      tokenFox <- tokenFoxOfFox
      token <- tokenFox
    } yield token
  }


  def dataSourceFor(dataSet: DataSet)(implicit ctx: DBAccessContext): Fox[InboxDataSource] = {
    for {
      organization <- organizationDAO.findOne(dataSet._organization)(GlobalAccessContext) ?~> "organization.notFound"
      dataLayersBox <- dataSetDataLayerDAO.findAllForDataSet(dataSet._id).futureBox
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
  }

  def logoUrlFor(dataSet: DataSet): Fox[String] =
    dataSet.logoUrl match {
      case Some(url) => Fox.successful(url)
      case None => organizationDAO.findOne(dataSet._organization)(GlobalAccessContext).map(_.logoUrl)
    }

  def dataStoreFor(dataSet: DataSet): Fox[DataStore] =
    dataStoreDAO.findOneByName(dataSet._dataStore.trim)(GlobalAccessContext) ?~> "datastore.notFound"

  def handlerFor(dataSet: DataSet)(implicit ctx: DBAccessContext): Fox[DataStoreHandler] =
    for {
      dataStore <- dataStoreFor(dataSet)
    } yield new DataStoreHandler(dataStore, dataSet)

  def lastUsedTimeFor(_dataSet: ObjectId, userOpt: Option[User])(implicit ctx: DBAccessContext): Fox[Long] = {
    userOpt match {
      case Some(user) =>
        (for {
          lastUsedTime <- dataSetLastUsedTimesDAO.findForDataSetAndUser(_dataSet, user._id).futureBox
        } yield lastUsedTime.toOption.getOrElse(0L)).toFox
      case _ => Fox.successful(0L)
    }
  }

  def allowedTeamIdsFor(_dataSet: ObjectId)(implicit ctx: DBAccessContext) =
    dataSetAllowedTeamsDAO.findAllForDataSet(_dataSet)(GlobalAccessContext) ?~> "allowedTeams.notFound"

  def allowedTeamsFor(_dataSet: ObjectId)(implicit ctx: DBAccessContext) =
    for {
      allowedTeamIds <- allowedTeamIdsFor(_dataSet)
      allowedTeams <- Fox.combined(allowedTeamIds.map(teamDAO.findOne(_)(GlobalAccessContext)))
    } yield allowedTeams


  def isEditableBy(dataSet: DataSet, userOpt: Option[User])(implicit ctx: DBAccessContext): Fox[Boolean] = {
    userOpt match {
      case Some(user) =>
        for {
          isTeamManagerInOrg <- userService.isTeamManagerInOrg(user, dataSet._organization)
        } yield (user.isAdminOf(dataSet._organization) || isTeamManagerInOrg)
      case _ => Fox.successful(false)
    }
  }

  def publicWrites(dataSet: DataSet, userOpt: Option[User]): Fox[JsObject] = {
    implicit val ctx = GlobalAccessContext
    for {
      teams <- allowedTeamsFor(dataSet._id)
      teamsJs <- Fox.serialCombined(teams)(t => teamService.publicWrites(t))
      logoUrl <- logoUrlFor(dataSet)
      isEditable <- isEditableBy(dataSet, userOpt)
      lastUsedByUser <- lastUsedTimeFor(dataSet._id, userOpt)
      dataStore <- dataStoreFor(dataSet)
      dataStoreJs <- dataStoreService.publicWrites(dataStore)
      organization <- organizationDAO.findOne(dataSet._organization) ?~> "organization.notFound"
      dataSource <- dataSourceFor(dataSet)
    } yield {
      Json.obj("name" -> dataSet.name,
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
        "isForeign" -> dataStore.isForeign)
    }
  }
}
