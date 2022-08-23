package com.scalableminds.webknossos.datastore.storage.httpsfilesystem

class HttpFileSystemProvider extends HttpsFileSystemProvider {
  override def getScheme: String = "http"
}
