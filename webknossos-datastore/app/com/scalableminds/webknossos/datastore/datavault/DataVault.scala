package com.scalableminds.webknossos.datastore.datavault

trait DataVault {
  def readBytes(path: VaultPath, range: RangeSpecifier): (Array[Byte], Encoding.Value)

}
