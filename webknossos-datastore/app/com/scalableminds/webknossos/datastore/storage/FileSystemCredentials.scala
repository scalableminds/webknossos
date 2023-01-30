package com.scalableminds.webknossos.datastore.storage

import play.api.libs.json.{JsValue, Json, OFormat}

sealed trait FileSystemCredential {
  def usernameOpt: Option[String] // TODO remove, rewrite FileSystemsHolder to use different types of credentials
  def passwordOpt: Option[String]
}

object FileSystemCredential {
  implicit val jsonFormat: OFormat[FileSystemCredential] = Json.format[FileSystemCredential]
}

case class HttpBasicAuthCredential(name: String, username: String, password: String, user: String, organization: String)
    extends FileSystemCredential {
  override def usernameOpt: Option[String] = Some(username)
  override def passwordOpt: Option[String] = Some(password)
}

object HttpBasicAuthCredential {
  implicit val jsonFormat: OFormat[HttpBasicAuthCredential] = Json.format[HttpBasicAuthCredential]
}

case class S3AccessKeyCredential(name: String, keyId: String, key: String, user: String, organization: String)
    extends FileSystemCredential {

  override def usernameOpt: Option[String] = Some(keyId)
  override def passwordOpt: Option[String] = Some(key)
}

object S3AccessKeyCredential {
  implicit val jsonFormat: OFormat[S3AccessKeyCredential] = Json.format[S3AccessKeyCredential]
}

case class GoogleServiceAccountCredential(name: String, secretJson: JsValue, user: String, organization: String)
    extends FileSystemCredential {
  override def usernameOpt: Option[String] = None
  override def passwordOpt: Option[String] = None
}

object GoogleServiceAccountCredential {
  implicit val jsonFormat: OFormat[GoogleServiceAccountCredential] = Json.format[GoogleServiceAccountCredential]
}

case class LegacyFileSystemCredential(user: String, password: Option[String]) extends FileSystemCredential {
  override def usernameOpt: Option[String] = Some(user)
  override def passwordOpt: Option[String] = password
}

object LegacyFileSystemCredential {
  implicit val jsonFormat: OFormat[LegacyFileSystemCredential] = Json.format[LegacyFileSystemCredential]
}
