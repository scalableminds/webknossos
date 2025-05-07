package com.scalableminds.webknossos.datastore.storage

import com.scalableminds.util.tools.{ConfigReader, JsonHelper}
import com.typesafe.config.Config
import play.api.Configuration
import play.api.libs.json.JsValue

class CredentialConfigReader(underlyingConfig: Config) extends ConfigReader {
  override val raw: Configuration = Configuration(underlyingConfig)

  def getCredential: Option[DataVaultCredential] =
    for {
      typeLiteral <- getOptional[String]("type")
      typeParsed <- CredentialType.fromString(typeLiteral)
      credential <- typeParsed match {
        case CredentialType.S3AccessKey          => getAsS3
        case CredentialType.HttpBasicAuth        => getAsHttpsBasicAuth
        case CredentialType.GoogleServiceAccount => getAsGoogleServiceAccount
        // Keep in sync with parse methods in CredentialDAO
        case _ => None
      }
    } yield credential

  private def getAsS3: Option[S3AccessKeyCredential] =
    for {
      name <- getOptional[String]("name")
      keyId <- getOptional[String]("identifier")
      key <- getOptional[String]("secret")
    } yield
      S3AccessKeyCredential(
        name,
        keyId,
        key,
        None,
        None
      )

  private def getAsHttpsBasicAuth: Option[HttpBasicAuthCredential] =
    for {
      name <- getOptional[String]("name")
      username <- getOptional[String]("identifier")
      password <- getOptional[String]("secret")
    } yield
      HttpBasicAuthCredential(
        name,
        username,
        password,
        None,
        None
      )

  private def getAsGoogleServiceAccount: Option[GoogleServiceAccountCredential] =
    for {
      name <- getOptional[String]("name")
      secret <- getOptional[String]("secret")
      secretJson <- JsonHelper.parseAs[JsValue](secret).toOption
    } yield
      GoogleServiceAccountCredential(
        name,
        secretJson,
        None,
        None
      )
}
