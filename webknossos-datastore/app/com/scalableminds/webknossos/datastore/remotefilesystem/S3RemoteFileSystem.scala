package com.scalableminds.webknossos.datastore.remotefilesystem

import com.scalableminds.webknossos.datastore.storage.{RemoteSourceDescriptor, S3AccessKeyCredential}

import java.net.URI

class S3RemoteFileSystem(s3AccessKeyCredential: Option[S3AccessKeyCredential]) extends RemoteFileSystem {
  override def get(key: String, path: RemotePath, range: Option[Range]): Array[Byte] = ???
}

object S3RemoteFileSystem {
  def create(remoteSourceDescriptor: RemoteSourceDescriptor) = {
    val credential = remoteSourceDescriptor.credential.map(f => f.asInstanceOf[S3AccessKeyCredential])
    new RemotePath(remoteSourceDescriptor.uri, new S3RemoteFileSystem(credential), credential)
  }
}
