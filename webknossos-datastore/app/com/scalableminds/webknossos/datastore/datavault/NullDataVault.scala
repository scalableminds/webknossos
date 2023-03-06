package com.scalableminds.webknossos.datastore.datavault

class NullDataVault extends DataVault {
  override def get(key: String, path: VaultPath, range: Option[Range]): Array[Byte] = ???
}
object NullDataVault {
  def create = new NullDataVault
}
