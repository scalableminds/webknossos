package models.binary

import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.models.datasource.inbox.{InboxDataSourceLike => InboxDataSource}
import com.typesafe.scalalogging.LazyLogging
import models.team.OrganizationDAO
import net.liftweb.common.Full
import oxalis.security.{URLSharing, WebknossosSilhouette}
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
                     dataStore: DataStoreInfo,
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

  def updateDataSource(
                        dataStoreInfo: DataStoreInfo,
                        dataSource: InboxDataSource
                      )(implicit ctx: DBAccessContext): Fox[Unit] = {

    DataSetDAO.findOneByName(dataSource.id.name)(GlobalAccessContext).futureBox.flatMap {
      case Full(dataSet) if dataSet._dataStore == dataStoreInfo.name =>
        DataSetDAO.updateDataSourceByName(
          dataSource.id.name,
          dataStoreInfo.name,
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
          dataStoreInfo,
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
    val dataStoreInfo = DataStoreInfo(dataStore.name, dataStore.url, dataStore.typ)
    Fox.serialSequence(dataSources) { dataSource =>
      DataSetService.updateDataSource(dataStoreInfo, dataSource)
    }
  }

  def getSharingToken(dataSetName: String)(implicit ctx: DBAccessContext) = {

    def createSharingToken(dataSetName: String)(implicit ctx: DBAccessContext) = {
      val tokenValue = URLSharing.generateToken
      for {
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
