/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.util.auth

import play.api.libs.json._

case class AccessToken(accessToken: String, scope: String, tokenType: String)

object AccessToken {


  implicit val accessTokenFormat = Json.format[AccessToken]
}
