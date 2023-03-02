package com.scalableminds.webknossos.datastore.remotefilesystem

trait RemoteFileSystem {
  def get(key: String, path: RemotePath, range: Option[Range] = None): Array[Byte]
}
