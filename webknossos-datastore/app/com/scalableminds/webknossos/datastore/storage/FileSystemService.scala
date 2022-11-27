package com.scalableminds.webknossos.datastore.storage

import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.option2Fox
import com.scalableminds.webknossos.datastore.dataformats.MagLocator
import com.scalableminds.webknossos.datastore.dataformats.zarr.RemoteSourceDescriptor
import com.scalableminds.webknossos.datastore.services.DSRemoteWebKnossosClient

import javax.inject.Inject
import scala.concurrent.ExecutionContext

class FileSystemService @Inject()(dSRemoteWebKnossosClient: DSRemoteWebKnossosClient) {
  def sayHi: Unit = println("hi!")

  def remoteSourceFor(magLocator: MagLocator)(implicit ec: ExecutionContext): Fox[RemoteSourceDescriptor] =
    magLocator.remoteSource.toFox
}
