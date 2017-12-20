/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.util.github.requesters

import com.scalableminds.util.github.models.GithubCollaborator
import com.typesafe.scalalogging.LazyLogging
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.Reads._
import play.api.libs.json._

trait GithubCollaboratorRequester extends GithubRequester with LazyLogging {

  def repoCollaboratorsUrl(repo: String): String

  def isCollaborator(userId: String, token: String, repo: String) =
    listCollaborators(token, repo).map(_.map(_.toString).contains(userId))

  def listCollaborators(token: String, repo: String) =
    githubRequest(repoCollaboratorsUrl(repo))(token).get().map {
      response =>
        response.json.validate(extractCollaborators).fold(
          invalid => {
            logger.warn("An error occurred while trying to decode orgs: " + invalid)
            Nil
          },
          valid => valid.map(_.id)
        )
    }

  val extractCollaborators = (__).read(list[GithubCollaborator])
}
