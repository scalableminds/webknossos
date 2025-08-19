package com.scalableminds.webknossos.datastore.models.datasource

object DataSourceStatus {
  val unreported: String = "No longer available on datastore."
  val deletedByUser: String = "Deleted by user."
  val notYetUploaded = "Not yet fully uploaded."
  val notYetManuallyUploaded = "Not yet marked as fully manually uploaded."

  val unreportedStatusList: Seq[String] = List(unreported, deletedByUser)
  val inactiveStatusList: Seq[String] = List(unreported, notYetUploaded, notYetManuallyUploaded, deletedByUser)
}
