package com.scalableminds.webknossos.datastore.remotefilesystem

import com.scalableminds.webknossos.datastore.storage.{GoogleServiceAccountCredential, RemoteSourceDescriptor}

import java.net.URI

class GoogleCloudRemoteFileSystem(credential: Option[GoogleServiceAccountCredential]) extends RemoteFileSystem {
  override def get(key: String, path: RemotePath, range: Option[Range]): Array[Byte] = ???
}

object GoogleCloudRemoteFileSystem {
  def create(remoteSourceDescriptor: RemoteSourceDescriptor) = {
    val credential = remoteSourceDescriptor.credential.map(f => f.asInstanceOf[GoogleServiceAccountCredential])
    new RemotePath(remoteSourceDescriptor.uri, new GoogleCloudRemoteFileSystem(credential), credential)
  }
}
