/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.util.github.models

import play.api.libs.json.Json

case class GithubUserDetails(id: Int, login: String, email: Option[String], name: Option[String])

object GithubUserDetails{
  implicit val githubUserDetailFormat = Json.format[GithubUserDetails]
}
