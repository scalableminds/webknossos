/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package models.binary

import com.scalableminds.braingames.binary.models._
import com.scalableminds.util.geometry.Point3D
import com.scalableminds.util.reactivemongo.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Full
import play.api.libs.concurrent.Akka
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.ws.WSResponse
import reactivemongo.api.commands.WriteResult

object DataSetService extends FoxImplicits with LazyLogging {
  val system = Akka.system(play.api.Play.current)

  def updateTeams(dataSet: DataSet, teams: List[String])(implicit ctx: DBAccessContext) =
    DataSetDAO.updateTeams(dataSet.name, teams)

  def update(dataSet: DataSet, description: Option[String], isPublic: Boolean)(implicit ctx: DBAccessContext) =
    DataSetDAO.update(dataSet.name, description, isPublic)

  def isProperDataSetName(name: String) = name.matches("[A-Za-z0-9_\\-]*")

  def checkIfNewDataSetName(name: String)(implicit ctx: DBAccessContext) = {
    findDataSource(name)(GlobalAccessContext).reverse
  }

  def defaultDataSetPosition(dataSetName: String)(implicit ctx: DBAccessContext) = {
    DataSetDAO.findOneBySourceName(dataSetName).futureBox.map {
      case Full(dataSet) =>
        dataSet.defaultStart
      case _             =>
        Point3D(0, 0, 0)
    }
  }

  def createDataSet(
    name: String,
    dataStore: DataStoreInfo,
    sourceType: String,
    owningTeam: String,
    dataSource: Option[DataSource] = None,
    isActive: Boolean = false)(implicit ctx: DBAccessContext) = {

    DataSetDAO.insert(DataSet(
      name,
      dataStore,
      dataSource,
      sourceType,
      owningTeam,
      List(owningTeam),
      isActive = isActive,
      isPublic = false,
      accessToken = None))(GlobalAccessContext)
  }

  def updateDataSource(
    dataStoreInfo: DataStoreInfo,
    dataSource: DataSourceLike)(implicit ctx: DBAccessContext): Fox[WriteResult] = {

    DataSetDAO.findOneBySourceName(dataSource.id)(GlobalAccessContext).futureBox.flatMap {
      case Full(dataSet) if dataSet.dataStoreInfo.name == dataStoreInfo.name =>
        DataSetDAO.updateDataSource(
          dataSource.id,
          dataStoreInfo,
          dataSource.source,
          isActive = dataSource.isUsable)(GlobalAccessContext).futureBox
      case Full(_)                                                           =>
        // TODO: There is a problem: The dataset name is already in use. We are not going to update that datasource.
        // this should be somehow populated to the user to inform him that he needs to rename the datasource
        Fox.failure("dataset.name.alreadyInUse").futureBox
      case _                                                                 =>
        createDataSet(
          dataSource.id,
          dataStoreInfo,
          dataSource.sourceType,
          dataSource.owningTeam,
          dataSource.source,
          isActive = dataSource.isUsable).futureBox
    }
  }

  def importDataSet(dataSet: DataSet)(implicit ctx: DBAccessContext): Fox[WSResponse] = {
    DataStoreHandler.importDataSource(dataSet)
  }

  def getDataLayer(dataSet: DataSet, dataLayerName: String)(implicit ctx: DBAccessContext): Fox[DataLayer] = {
    dataSet
    .dataSource.flatMap(_.getDataLayer(dataLayerName)).toFox
    .orElse(UserDataLayerDAO.findOneByName(dataLayerName).filter(_.dataSourceName == dataSet.name).map(_.dataLayer))
  }

  def findDataSource(name: String)(implicit ctx: DBAccessContext) =
    DataSetDAO.findOneBySourceName(name).flatMap(_.dataSource)

  def updateDataSources(dataStore: DataStore, dataSources: List[DataSourceLike])(implicit ctx: DBAccessContext) = {
    logger.info(s"[${dataStore.name}] Available datasets: " +
      s"${dataSources.count(_.isUsable)} (usable), ${dataSources.count(!_.isUsable)} (unusable)")
    logger.debug(s"Found datasets: " + dataSources.map(_.id).mkString(", "))
    dataSources.map { dataSource =>
      DataSetService.updateDataSource(
        DataStoreInfo(dataStore.name, dataSource.serverUrl, dataStore.typ, None), dataSource)
    }
  }
}
