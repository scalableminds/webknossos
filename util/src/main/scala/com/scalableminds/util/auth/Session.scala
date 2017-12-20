/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.util.auth

import play.api.libs.json.Json

case class Session(token: String, userId: Int)

object Session{
  val sessionFormat = Json.format[Session]
}