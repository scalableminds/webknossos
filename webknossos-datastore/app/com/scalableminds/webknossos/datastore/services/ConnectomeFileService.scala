package com.scalableminds.webknossos.datastore.services

import java.nio.file.Paths

import com.scalableminds.util.io.PathUtils
import com.scalableminds.util.tools.FoxImplicits
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.storage.Hdf5FileCache
import com.typesafe.scalalogging.LazyLogging
import javax.inject.Inject
import org.apache.commons.io.FilenameUtils

import scala.concurrent.ExecutionContext

class ConnectomeFileService @Inject()(config: DataStoreConfig)(implicit ec: ExecutionContext)
    extends FoxImplicits
    with LazyLogging {

  private val dataBaseDir = Paths.get(config.Datastore.baseFolder)
  private val connectomesDir = "connectomes"
  private val connectomeFileExtension = "hdf5"

  private lazy val connectomeFileCache = new Hdf5FileCache(30)

  def exploreConnectomeFiles(organizationName: String, dataSetName: String, dataLayerName: String): Set[String] = {
    val layerDir = dataBaseDir.resolve(organizationName).resolve(dataSetName).resolve(dataLayerName)
    PathUtils
      .listFiles(layerDir.resolve(connectomesDir), PathUtils.fileExtensionFilter(connectomeFileExtension))
      .map { paths =>
        paths.map(path => FilenameUtils.removeExtension(path.getFileName.toString))
      }
      .toOption
      .getOrElse(Nil)
      .toSet
  }
}
