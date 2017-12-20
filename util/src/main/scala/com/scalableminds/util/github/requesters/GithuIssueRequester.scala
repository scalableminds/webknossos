/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.util.github.requesters

import com.scalableminds.util.github.ResultSet
import com.scalableminds.util.github.models.GithubIssue
import com.typesafe.scalalogging.LazyLogging
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.Reads._
import play.api.libs.json._

import scala.concurrent.Future

trait GithuIssueRequester extends GithubRequester with LazyLogging {

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
        logger.info("Update returned: " + response.status)
        if (response.status != 200)
          logger.warn(response.body)
        response.status == 200
    }
  }

  val extractIssues = (__).read(list[GithubIssue])
}
