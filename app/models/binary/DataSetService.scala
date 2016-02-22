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
import controllers.DataStoreHandler
import reactivemongo.api.commands.WriteResult
import reactivemongo.core.commands.LastError
import com.scalableminds.util.rest.RESTResponse

object DataSetService extends FoxImplicits {
  val system = Akka.system(play.api.Play.current)

  def updateTeams(dataSet: DataSet, teams: List[String])(implicit ctx: DBAccessContext) =
    DataSetDAO.updateTeams(dataSet.name, teams)

  def isProperDataSetName(name: String) = name.matches("[A-Za-z0-9_\\-]*")

  def createDataSet(
                     id: String,
                     dataStore: DataStoreInfo,
                     sourceType: String,
                     owningTeam: String,
                     dataSource: Option[DataSource] = None,
                     isActive: Boolean = false)(implicit ctx: DBAccessContext) = {
    DataSetDAO.insert(DataSet(
      id,
      dataStore,
      dataSource,
      sourceType,
      owningTeam,
      List(owningTeam),
      isActive = isActive,
      isPublic = false,
      accessToken = None))(GlobalAccessContext)
  }

  def updateDataSource(dataStoreInfo: DataStoreInfo, usableDataSource: UsableDataSource)(implicit ctx: DBAccessContext): Fox[WriteResult] = {
    DataSetDAO.findOneBySourceName(usableDataSource.id)(GlobalAccessContext).futureBox.flatMap {
      case Full(dataSet) if (dataSet.dataStoreInfo.name == dataStoreInfo.name) =>
        DataSetDAO.updateDataSource(usableDataSource.id, dataStoreInfo, usableDataSource.dataSource)(GlobalAccessContext).futureBox
      case Full(_) =>
        // TODO: There is a problem here. The dataset name is already in use. We are not going to update that datasource.
        // this should be somehow populated to the user to inform him that he needs to rename the datasource
        Fox.failure("dataset.name.alreadyInUse").futureBox
      case _ =>
        createDataSet(
          usableDataSource.id,
          dataStoreInfo,
          usableDataSource.sourceType,
          usableDataSource.owningTeam,
          Some(usableDataSource.dataSource),
          isActive = true).futureBox
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

  def updateDataSources(dataStoreName: String, dataSources: List[DataSourceLike])(implicit ctx: DBAccessContext) = {
    Logger.info(s"[$dataStoreName] Available datasets: " + dataSources.map(_.id).mkString(", "))
    dataSources.map {
      case d: UsableDataSource =>
        DataSetService.updateDataSource(DataStoreInfo(dataStoreName, d.serverUrl), d)
      case d: UnusableDataSource =>
        for {
          _ <- DataSetDAO.removeByName(d.id)(GlobalAccessContext)
          _ <- DataSetService.createDataSet(d.id, DataStoreInfo(dataStoreName, d.serverUrl), d.sourceType, d.owningTeam, isActive = false)
        } yield true
    }
  }
}
