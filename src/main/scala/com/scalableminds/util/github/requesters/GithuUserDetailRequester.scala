/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.util.github.requesters

import scala.concurrent.Future
import play.api.Logger
import com.scalableminds.util.github.models.GithubUserDetails
import play.api.libs.concurrent.Execution.Implicits._

trait GithuUserDetailRequester extends GithubRequester {

  val userUrl: String

  def userDetails(token: String): Future[Option[GithubUserDetails]] = {
    Logger.info("Requesting user details.")
    githubRequest(userUrl)(token).get().map {
      response =>
        Logger.info("User details response status: " + response.status)
        response.json.validate(GithubUserDetails.githubUserDetailFormat).fold(
          invalid => {
            Logger.warn("An error occurred while trying to decode user details: " + invalid)
            None
          },
          valid => {
            Logger.info("Successfuly requested user details.")
            Some(valid)
          }
        )
    }
  }
}
