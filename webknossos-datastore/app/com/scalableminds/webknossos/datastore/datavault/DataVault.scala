package com.scalableminds.webknossos.datastore.datavault

import scala.collection.immutable.NumericRange

trait DataVault {
  def readBytes(path: VaultPath, range: Option[NumericRange[Long]] = None): Array[Byte]
}
