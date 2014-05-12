/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.util.github.requesters

import play.api.libs.json._
import play.api.Logger
import play.api.libs.json.Reads._
import com.scalableminds.util.github.models.GithubCollaborator
import play.api.libs.concurrent.Execution.Implicits._

trait GithubCollaboratorRequester extends GithubRequester {

  def repoCollaboratorsUrl(repo: String): String

  def isCollaborator(userId: String, token: String, repo: String) =
    listCollaborators(token, repo).map(_.map(_.toString).contains(userId))

  def listCollaborators(token: String, repo: String) =
    githubRequest(repoCollaboratorsUrl(repo))(token).get().map {
      response =>
        response.json.validate(extractCollaborators).fold(
          invalid => {
            Logger.warn("An error occurred while trying to decode orgs: " + invalid)
            Nil
          },
          valid => valid.map(_.id)
        )
    }

  val extractCollaborators = (__).read(list[GithubCollaborator])
}
