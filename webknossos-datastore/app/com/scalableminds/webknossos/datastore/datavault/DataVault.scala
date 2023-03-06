package com.scalableminds.webknossos.datastore.datavault

trait DataVault {
  def get(key: String, path: VaultPath, range: Option[Range] = None): Array[Byte]
}
