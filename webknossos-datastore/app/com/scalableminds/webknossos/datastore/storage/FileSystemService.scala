package com.scalableminds.webknossos.datastore.storage

import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.dataformats.MagLocator
import com.scalableminds.webknossos.datastore.dataformats.zarr.RemoteSourceDescriptor
import com.scalableminds.webknossos.datastore.services.DSRemoteWebKnossosClient

import java.net.URI
import javax.inject.Inject
import scala.concurrent.ExecutionContext

class FileSystemService @Inject()(dSRemoteWebKnossosClient: DSRemoteWebKnossosClient) {

  private def remoteSourceDescriptorFromCredential(uri: URI, credential: AnyCredential): RemoteSourceDescriptor =
    credential match {
      case HttpBasicAuthCredential(name, username, password, _, _) =>
        RemoteSourceDescriptor(uri, Some(username), Some(password))
      case S3AccessKeyCredential(name, keyId, key, _, _) => RemoteSourceDescriptor(uri, Some(keyId), Some(key))
    }

  def remoteSourceFor(magLocator: MagLocator)(implicit ec: ExecutionContext): Fox[RemoteSourceDescriptor] =
    magLocator.credentialId match {
      case Some(credentialId) =>
        for {
          credential <- dSRemoteWebKnossosClient.findCredential(credentialId)
          descriptor = remoteSourceDescriptorFromCredential(magLocator.uri, credential)
        } yield descriptor
      case None => Fox.empty
    }

}
