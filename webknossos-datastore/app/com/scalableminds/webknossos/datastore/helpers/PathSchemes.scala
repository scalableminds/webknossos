package com.scalableminds.webknossos.datastore.helpers

object PathSchemes {
  val schemeS3: String = "s3"
  val schemeHttps: String = "https"
  val schemeHttp: String = "http"
  val schemeGS: String = "gs"
  val schemeFile: String = "file"

  def isRemoteScheme(uriScheme: String): Boolean =
    List(schemeS3, schemeHttps, schemeHttp, schemeGS).contains(uriScheme)
}
