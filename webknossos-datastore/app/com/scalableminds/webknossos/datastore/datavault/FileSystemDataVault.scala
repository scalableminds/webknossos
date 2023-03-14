package com.scalableminds.webknossos.datastore.datavault

import scala.collection.immutable.NumericRange

class FileSystemDataVault extends DataVault {
  override def readBytes(path: VaultPath, range: Option[NumericRange[Long]]): Array[Byte] = ???
}
object FileSystemDataVault {
  def create = new FileSystemDataVault
}
