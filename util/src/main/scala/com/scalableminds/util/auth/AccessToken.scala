package com.scalableminds.util.auth

import play.api.libs.json._

case class AccessToken(accessToken: String, scope: String, tokenType: String)

object AccessToken {


  implicit val accessTokenFormat = Json.format[AccessToken]
}
