/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package models.binary

import braingames.reactivemongo.{GlobalAccessContext, DBAccessContext}
import play.api.Logger
import play.api.libs.concurrent.Akka
import net.liftweb.common.Full
import scala.Some
import braingames.util.{Fox, FoxImplicits}
import braingames.binary.models.{DataSource, UnusableDataSource, DataSourceLike, UsableDataSource}
import play.api.i18n.Messages
import play.api.libs.concurrent.Execution.Implicits._
import controllers.DataStoreHandler
import reactivemongo.core.commands.LastError

object DataSetService extends FoxImplicits {
  val system = Akka.system(play.api.Play.current)

  def updateTeams(dataSet: DataSet, teams: List[String])(implicit ctx: DBAccessContext) =
    DataSetDAO.updateTeams(dataSet.name, teams)

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
      isActive = isActive))(GlobalAccessContext)
  }

  def updateDataSource(dataStoreInfo: DataStoreInfo, usableDataSource: UsableDataSource)(implicit ctx: DBAccessContext): Fox[LastError] = {
    DataSetDAO.findOneBySourceName(usableDataSource.id)(GlobalAccessContext).futureBox.flatMap {
      case Full(dataSet) if (dataSet.dataStoreInfo.name == dataStoreInfo.name) =>
        DataSetDAO.updateDataSource(usableDataSource.id, dataStoreInfo, usableDataSource.dataSource)(GlobalAccessContext).futureBox
      case Full(_) =>
        // TODO: There is a problem here. The dataset name is already in use. We are not going to update that datasource.
        // this should be somehow populated to the user to inform him that he needs to rename the datasource
        Fox.failure(Messages("dataset.name.alreadyInUse")).futureBox
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

  def importDataSet(dataSet: DataSet)(implicit ctx: DBAccessContext) = {
    DataStoreHandler.importDataSource(dataSet)
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