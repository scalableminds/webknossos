/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package models.binary

import com.scalableminds.util.geometry.Point3D
import com.scalableminds.util.reactivemongo.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.models.datasource.inbox.{InboxDataSourceLike => InboxDataSource}
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayerLike => DataLayer, DataSourceLike => DataSource}
import com.typesafe.scalalogging.LazyLogging
import models.team.OrganizationDAO
import net.liftweb.common.Full
import oxalis.security.{URLSharing, WebknossosSilhouette}
import play.api.libs.concurrent.Akka
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.ws.WSResponse
import reactivemongo.bson.BSONObjectID

object DataSetService extends FoxImplicits with LazyLogging {

  val system = Akka.system(play.api.Play.current)

  def updateTeams(dataSet: DataSet, teams: List[BSONObjectID])(implicit ctx: DBAccessContext) =
    DataSetDAO.updateTeams(dataSet.name, teams)

  def update(dataSet: DataSet, description: Option[String], displayName: Option[String], isPublic: Boolean)(implicit ctx: DBAccessContext) =
    DataSetDAO.update(dataSet.name, description, displayName, isPublic)

  def isProperDataSetName(name: String): Boolean =
    name.matches("[A-Za-z0-9_\\-]*")

  def checkIfNewDataSetName(name: String)(implicit ctx: DBAccessContext): Fox[Boolean] =
    findDataSource(name)(GlobalAccessContext).reverse

  def createDataSet(
                     name: String,
                     dataStore: DataStoreInfo,
                     owningOrganization: String,
                     dataSource: InboxDataSource,
                     isActive: Boolean = false
                     )(implicit ctx: DBAccessContext) = {
    OrganizationDAO.findOneByName(owningOrganization).futureBox.flatMap {
      case Full(_) =>
      DataSetDAO.insert(DataSet(
        None,
        dataStore,
        dataSource,
        owningOrganization,
        List(),
        isActive = isActive,
        isPublic = false))(GlobalAccessContext)
      case _ => Fox.failure("org.notExist")
    }
  }

  def updateDataSource(
                        dataStoreInfo: DataStoreInfo,
                        dataSource: InboxDataSource
                      )(implicit ctx: DBAccessContext): Fox[Unit] = {

    DataSetDAO.findOneBySourceName(dataSource.id.name)(GlobalAccessContext).futureBox.flatMap {
      case Full(dataSet) if dataSet.dataStoreInfo.name == dataStoreInfo.name =>
        DataSetDAO.updateDataSource(
          dataSource.id.name,
          dataStoreInfo,
          dataSource,
          isActive = dataSource.isUsable)(GlobalAccessContext).futureBox
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
    DataSetDAO.deactivateUnreportedDataSources(dataStoreName, dataSources)

  def importDataSet(dataSet: DataSet)(implicit ctx: DBAccessContext): Fox[WSResponse] = {
    dataSet.dataStore.importDataSource
  }

  def getDataLayer(dataSet: DataSet, dataLayerName: String)(implicit ctx: DBAccessContext): Fox[DataLayer] = {
    dataSet.dataSource.toUsable.flatMap(_.getDataLayer(dataLayerName)).toFox
  }

  def findDataSource(name: String)(implicit ctx: DBAccessContext): Fox[InboxDataSource] =
    DataSetDAO.findOneBySourceName(name).map(_.dataSource)

  def updateDataSources(dataStore: DataStore, dataSources: List[InboxDataSource])(implicit ctx: DBAccessContext) = {
    logger.info(s"[${dataStore.name}] Available datasets: " +
      s"${dataSources.count(_.isUsable)} (usable), ${dataSources.count(!_.isUsable)} (unusable)")
    //logger.debug(s"Found datasets: " + dataSources.map(_.id).mkString(", "))
    val dataStoreInfo = DataStoreInfo(dataStore.name, dataStore.url, dataStore.typ)
    Fox.serialSequence(dataSources) { dataSource =>
      DataSetService.updateDataSource(dataStoreInfo, dataSource)
    }
  }

  def getSharingToken(dataSetName: String)(implicit ctx: DBAccessContext) = {

    def createSharingToken(dataSetName: String)(implicit ctx: DBAccessContext) = {
      val tokenValue = URLSharing.generateToken
      for {
        _ <- DataSetSQLDAO.updateSharingTokenByName(dataSetName, Some(tokenValue))
      } yield tokenValue
    }

    val tokenFoxOfFox: Fox[Fox[String]] = DataSetSQLDAO.getSharingTokenByName(dataSetName).map {
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
