/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.util.github.requesters

import play.api.libs.json._
import scala.concurrent.Future
import play.api.Logger
import play.api.libs.json.Reads._
import com.scalableminds.util.github.ResultSet
import com.scalableminds.util.github.models.GithubIssue
import play.api.libs.concurrent.Execution.Implicits._

trait GithuIssueRequester extends GithubRequester {

  def issuesUrl(repo: String): String

  def listRepositoryIssues(token: String, repo: String) =
    new ResultSet(issuesUrl(repo), extractIssues, token).results.map {
      results =>
        results.flatten
    }

  def issueBodyUpdate(body: String) =
    Json.obj("body" -> body)

  def updateIssueBody(token: String, issue: GithubIssue, body: String): Future[Boolean] = {
    githubRequest(issue.url, prependHost = false)(token).post(issueBodyUpdate(body)).map {
      response =>
        Logger.info("Update returned: " + response.status)
        if (response.status != 200)
          Logger.warn(response.body)
        response.status == 200
    }
  }

  val extractIssues = (__).read(list[GithubIssue])
}
