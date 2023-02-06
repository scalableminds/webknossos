package com.scalableminds.webknossos.datastore.storage

import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.dataformats.MagLocator
import com.scalableminds.webknossos.datastore.services.DSRemoteWebKnossosClient
import net.liftweb.util.Helpers.tryo

import java.net.URI
import java.nio.file.Path
import javax.inject.Inject
import scala.concurrent.ExecutionContext

case class RemoteSourceDescriptor(uri: URI, credential: Option[FileSystemCredential])

class FileSystemService @Inject()(dSRemoteWebKnossosClient: DSRemoteWebKnossosClient) {

  def remotePathFor(magLocator: MagLocator)(implicit ec: ExecutionContext): Fox[Path] =
    for {
      credentialBox <- credentialFor(magLocator: MagLocator).futureBox
      remoteSource = RemoteSourceDescriptor(magLocator.uri, credentialBox.toOption)
      fileSystem <- FileSystemsHolder.getOrCreate(remoteSource) ?~> "remoteFileSystem.setup.failed"
      remotePath <- tryo(fileSystem.getPath(FileSystemsHolder.pathFromUri(remoteSource.uri)))
    } yield remotePath

  private def credentialFor(magLocator: MagLocator)(implicit ec: ExecutionContext): Fox[FileSystemCredential] =
    magLocator.credentialId match {
      case Some(credentialId) =>
        dSRemoteWebKnossosClient.getCredential(credentialId)
      case None =>
        magLocator.credentials match {
          case Some(credential) => Fox.successful(credential)
          case None             => Fox.empty
        }
    }

}
