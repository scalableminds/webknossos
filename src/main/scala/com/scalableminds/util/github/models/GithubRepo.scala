/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.util.github.models

import play.api.libs.json.Json

case class GithubRepository(full_name: String, permissions: GithubRepoPermissions)

object GithubRepository{
  implicit val githubRepositoryFormat = Json.format[GithubRepository]
}
