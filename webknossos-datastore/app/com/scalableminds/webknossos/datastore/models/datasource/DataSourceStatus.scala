package com.scalableminds.webknossos.datastore.models.datasource

object DataSourceStatus {
  val unreported: String = "No longer available on datastore."
  val deletedByUser: String = "Deleted by user."
  val notYetUploaded = "Not yet fully uploaded."
  val notYetUploadedToPaths = "Not yet marked as fully uploaded to paths."
  val notImportedYet: String = "Not imported yet."
  val conversionFailed: String = "Conversion failed."

  val unreportedStatusList: Seq[String] = List(unreported, deletedByUser, conversionFailed)
  val inactiveStatusList: Seq[String] =
    List(unreported, notYetUploaded, notYetUploadedToPaths, deletedByUser, conversionFailed)
}
