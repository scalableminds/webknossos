package com.scalableminds.webknossos.datastore.datavault

import scala.collection.immutable.NumericRange

class NullDataVault extends DataVault {
  override def readBytes(key: String, path: VaultPath, range: Option[NumericRange[Long]]): Array[Byte] = ???
}
object NullDataVault {
  def create = new NullDataVault
}
