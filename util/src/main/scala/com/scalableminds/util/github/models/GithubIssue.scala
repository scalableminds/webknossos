/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.util.github.models

import play.api.libs.json.Json

case class GithubIssue(url: String, title: String, body: String, number: Int, milestone: Option[GithubMilestone])

object GithubIssue{
  implicit val githubIssueFormat = Json.format[GithubIssue]
}