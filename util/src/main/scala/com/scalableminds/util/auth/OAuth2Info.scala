package com.scalableminds.util.auth

import play.api.libs.json.{Format, Json}

case class OAuth2Info(accessToken: String)

object OAuth2Info{
  implicit val OAuth2InfoFormat: Format[OAuth2Info] = Json.format[OAuth2Info]
}
