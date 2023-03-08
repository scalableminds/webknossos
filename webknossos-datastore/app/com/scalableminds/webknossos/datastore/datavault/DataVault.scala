package com.scalableminds.webknossos.datastore.datavault

import scala.collection.immutable.NumericRange

trait DataVault {
  def get(key: String, path: VaultPath, range: Option[NumericRange[Long]] = None): Array[Byte]
}
