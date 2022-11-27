package com.scalableminds.webknossos.datastore.storage

import com.scalableminds.webknossos.datastore.services.DSRemoteWebKnossosClient

import javax.inject.Inject

class FileSystemService @Inject()(DSRemoteWebKnossosClient: DSRemoteWebKnossosClient){
  def sayHi: Unit = println("hi!")
}
