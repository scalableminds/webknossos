package com.scalableminds.webknossos.datastore.services

import com.scalableminds.util.io.PathUtils
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.{Fox, FoxImplicits, JsonHelper}
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayer, DataSource, GenericDataSource}
import com.scalableminds.webknossos.datastore.models.datasource.inbox.UnusableDataSource
import net.liftweb.common.Full
import play.api.libs.json.Json

import java.nio.file.{Path, Paths}
import javax.inject.Inject
import scala.concurrent.ExecutionContext

class DatasetCache @Inject()(remoteWebknossosClient: DSRemoteWebknossosClient, config: DataStoreConfig)(
    implicit ec: ExecutionContext)
    extends PathUtils
    with FoxImplicits {

  val datasetCacheDir = ".datasetCache"
  val dataBaseDir: Path = Paths.get(config.Datastore.baseDirectory)

  def getById(organizationId: String, id: ObjectId): Fox[GenericDataSource[DataLayer]] = {
    val cachePath = dataBaseDir.resolve(organizationId).resolve(datasetCacheDir).resolve(id.toString)
    val cacheFile = cachePath.resolve(GenericDataSource.FILENAME_DATASOURCE_PROPERTIES_JSON)
    if (cacheFile.toFile.exists()) {
      JsonHelper.parseFromFileAs[DataSource](cacheFile, cachePath) match {
        case Full(dataSource) =>
          if (dataSource.dataLayers.nonEmpty) Fox.successful(dataSource)
          else {
            // TODO: Handle unhappy cases
            ???
          }
        case e => ???
      }
    } else {
      // Request dataset from remote webknossos
      for {
        dataSource <- remoteWebknossosClient.getDataset(id.toString)
        _ = PathUtils.ensureDirectory(cacheFile.getParent)
        _ <- JsonHelper.writeToFile(cacheFile, dataSource).toFox
      } yield dataSource
    }
  }

}
