package com.scalableminds.webknossos.datastore.services.connectome

import com.scalableminds.util.tools.Box.tryo
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.storage.{CachedHdf5File, Hdf5FileCache}

import java.nio.file.Path
import javax.inject.Inject

class Hdf5ConnectomeFileService @Inject()() {

  private lazy val connectomeFileCache = new Hdf5FileCache(30)

  def mappingNameForConnectomeFile(connectomeFilePath: Path): Fox[String] =
    for {
      cachedConnectomeFile <- tryo {
        connectomeFileCache.getCachedHdf5File(connectomeFilePath)(CachedHdf5File.fromPath)
      }.toFox ?~> "connectome.file.open.failed"
      mappingName <- finishAccessOnFailure(cachedConnectomeFile) {
        cachedConnectomeFile.stringReader.getAttr("/", "metadata/mapping_name")
      } ?~> "connectome.file.readEncoding.failed"
      _ = cachedConnectomeFile.finishAccess()
    } yield mappingName
}
