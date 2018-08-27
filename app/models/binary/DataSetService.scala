package models.binary

import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.rpc.RPC
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.models.datasource.inbox.{InboxDataSourceLike => InboxDataSource}
import com.typesafe.scalalogging.LazyLogging
import models.team.OrganizationDAO
import net.liftweb.common.Full
import oxalis.security.{CompactRandomIDGenerator, URLSharing, WebknossosSilhouette}
import play.api.libs.concurrent.Akka
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.ws.WSResponse
import utils.ObjectId

object DataSetService extends FoxImplicits with LazyLogging {

  val system = Akka.system(play.api.Play.current)

  def isProperDataSetName(name: String): Boolean =
    name.matches("[A-Za-z0-9_\\-]*")

  def assertNewDataSetName(name: String)(implicit ctx: DBAccessContext): Fox[Boolean] =
    DataSetDAO.findOneByName(name)(GlobalAccessContext).reverse

  def createDataSet(
                     name: String,
                     dataStore: DataStore,
                     owningOrganization: String,
                     dataSource: InboxDataSource,
                     isActive: Boolean = false
                     ) = {
    implicit val ctx = GlobalAccessContext
    val newId = ObjectId.generate
    OrganizationDAO.findOneByName(owningOrganization).futureBox.flatMap {
      case Full(organization) => for {
        _ <- DataSetDAO.insertOne(DataSet(
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
        _ <- DataSetDataLayerDAO.updateLayers(newId, dataSource)
        _ <- DataSetAllowedTeamsDAO.updateAllowedTeamsForDataSet(newId, List())
      } yield ()
      case _ => Fox.failure("org.notExist")
    }
  }

  def addForeignDataSet(dataStoreName: String, dataSetName: String, organizationName: String)(implicit ctx: DBAccessContext) = {
    for {
      dataStore <- DataStoreDAO.findOneByName(dataStoreName)
      foreignDataset <- getForeignDataSet(dataStore.url, dataSetName)
      _ <- DataSetService.createDataSet(dataSetName, dataStore, organizationName, foreignDataset)
    } yield {
      ()
    }
  }

  def getForeignDataSet(dataStoreUrl: String, dataSetName: String): Fox[InboxDataSource] = {
    RPC(s"${dataStoreUrl}/data/datasets/${dataSetName}/readInboxDataSourceLike")
      .withQueryString("token" -> "") // we don't need a valid token because the DataSet is public, but we have to add the parameter token because it is a TokenSecuredAction
      .getWithJsonResponse[InboxDataSource]
  }


  def addForeignDataStore(name: String, url: String)(implicit ctx: DBAccessContext) = {
    val dataStore = DataStore(name, url, "", isForeign = true) // the key can be "" because keys are only important for own DataStore. Own Datastores have a key that is not ""
    for {
      _ <- DataStoreDAO.insertOne(dataStore)
    } yield {
      ()
    }
  }

  def updateDataSource(
                        dataStore: DataStore,
                        dataSource: InboxDataSource
                      )(implicit ctx: DBAccessContext): Fox[Unit] = {

    DataSetDAO.findOneByName(dataSource.id.name)(GlobalAccessContext).futureBox.flatMap {
      case Full(dataSet) if dataSet._dataStore == dataStore.name =>
        DataSetDAO.updateDataSourceByName(
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
    DataSetDAO.deactivateUnreported(dataSources.map(_.id.name), dataStoreName)

  def importDataSet(dataSet: DataSet)(implicit ctx: DBAccessContext): Fox[WSResponse] =
    for {
      dataStoreHandler <- dataSet.dataStoreHandler
      result <- dataStoreHandler.importDataSource
    } yield result

  def updateDataSources(dataStore: DataStore, dataSources: List[InboxDataSource])(implicit ctx: DBAccessContext) = {
    logger.info(s"[${dataStore.name}] Available datasets: " +
      s"${dataSources.count(_.isUsable)} (usable), ${dataSources.count(!_.isUsable)} (unusable)")
    Fox.serialSequence(dataSources) { dataSource =>
      DataSetService.updateDataSource(dataStore, dataSource)
    }
  }

  def getSharingToken(dataSetName: String)(implicit ctx: DBAccessContext) = {

    def createSharingToken(dataSetName: String)(implicit ctx: DBAccessContext) = {
      for {
        tokenValue <- new CompactRandomIDGenerator().generate
        _ <- DataSetDAO.updateSharingTokenByName(dataSetName, Some(tokenValue))
      } yield tokenValue
    }

    val tokenFoxOfFox: Fox[Fox[String]] = DataSetDAO.getSharingTokenByName(dataSetName).map {
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
}
