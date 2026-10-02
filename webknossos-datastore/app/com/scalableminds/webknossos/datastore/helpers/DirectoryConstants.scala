package com.scalableminds.webknossos.datastore.helpers

trait DirectoryConstants {
  val forConversionDir = ".forConversion"
  val convertingDir = ".converting" // Created by the worker
  val trashDir = ".trash"
  val uploadingDir: String = ".uploading"
  val unpackedDir = ".unpacked"
}
