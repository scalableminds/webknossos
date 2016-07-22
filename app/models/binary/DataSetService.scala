/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package models.binary

import com.scalableminds.util.reactivemongo.{GlobalAccessContext, DBAccessContext}
import play.api.Logger
import play.api.libs.concurrent.Akka
import net.liftweb.common.Full
import scala.Some
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.braingames.binary.models._
import play.api.i18n.Messages
import play.api.libs.concurrent.Execution.Implicits._
import reactivemongo.api.commands.WriteResult
import reactivemongo.core.commands.LastError
import com.scalableminds.util.rest.RESTResponse

object DataSetService extends FoxImplicits {
  val system = Akka.system(play.api.Play.current)

  def updateTeams(dataSet: DataSet, teams: List[String])(implicit ctx: DBAccessContext) =
    DataSetDAO.updateTeams(dataSet.name, teams)

  def update(dataSet: DataSet, description: Option[String], isPublic: Boolean)(implicit ctx: DBAccessContext) =
    DataSetDAO.update(dataSet.name, description, isPublic)

  def isProperDataSetName(name: String) = name.matches("[A-Za-z0-9_\\-]*")

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

  def updateDataSource(dataStoreInfo: DataStoreInfo, dataSource: DataSourceLike)(implicit ctx: DBAccessContext): Fox[WriteResult] = {
    DataSetDAO.findOneBySourceName(dataSource.id)(GlobalAccessContext).futureBox.flatMap {
      case Full(dataSet) if dataSet.dataStoreInfo.name == dataStoreInfo.name =>
        DataSetDAO.updateDataSource(
          dataSource.id,
          dataStoreInfo,
          dataSource.source,
          isActive = dataSource.isUsable)(GlobalAccessContext).futureBox
      case Full(_) =>
        // TODO: There is a problem here. The dataset name is already in use. We are not going to update that datasource.
        // this should be somehow populated to the user to inform him that he needs to rename the datasource
        Fox.failure("dataset.name.alreadyInUse").futureBox
      case _ =>
        createDataSet(
          dataSource.id,
          dataStoreInfo,
          dataSource.sourceType,
          dataSource.owningTeam,
          dataSource.source,
          isActive = dataSource.isUsable).futureBox
    }
  }

  def importDataSet(dataSet: DataSet)(implicit ctx: DBAccessContext): Fox[RESTResponse] = {
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
    Logger.info(s"[${dataStore.name}] Available datasets: ${dataSources.count(_.isUsable)} (usable), ${dataSources.count(!_.isUsable)} (unusable)")
    Logger.debug(s"Found datasets: "+ dataSources.map(_.id).mkString(", "))
    dataSources.map { dataSource =>
      DataSetService.updateDataSource(DataStoreInfo(dataStore.name, dataSource.serverUrl, dataStore.typ, None), dataSource)
    }
  }
}
