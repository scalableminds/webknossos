/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.util.github.models

import play.api.libs.json.Json

case class GithubRepoPermissions(admin: Boolean, push: Boolean, pull: Boolean)

object GithubRepoPermissions{
  implicit val githubRepoPermissionsFormat = Json.format[GithubRepoPermissions]
}
