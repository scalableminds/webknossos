package com.scalableminds.webknossos.datastore.storage

import play.api.libs.json.{Json, OFormat}

sealed trait AnyCredential

object AnyCredential {
  implicit val jsonFormat: OFormat[AnyCredential] = Json.format[AnyCredential]
}

case class HttpBasicAuthCredential(name: String, username: String, password: String, domain: String)
    extends AnyCredential

object HttpBasicAuthCredential {
  implicit val jsonFormat: OFormat[HttpBasicAuthCredential] = Json.format[HttpBasicAuthCredential]
}

case class S3AccessKeyCredential(name: String, keyId: String, key: String, bucket: String) extends AnyCredential

object S3AccessKeyCredential {
  implicit val jsonFormat: OFormat[S3AccessKeyCredential] = Json.format[S3AccessKeyCredential]
}
