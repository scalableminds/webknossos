/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.util.github.requesters

import com.scalableminds.util.github.models.GithubUserDetails
import com.typesafe.scalalogging.LazyLogging
import play.api.libs.concurrent.Execution.Implicits._

import scala.concurrent.Future

trait GithuUserDetailRequester extends GithubRequester with LazyLogging{

  val userUrl: String

  def userDetails(token: String): Future[Option[GithubUserDetails]] = {
    logger.info("Requesting user details.")
    githubRequest(userUrl)(token).get().map {
      response =>
        logger.info("User details response status: " + response.status)
        response.json.validate(GithubUserDetails.githubUserDetailFormat).fold(
          invalid => {
            logger.warn("An error occurred while trying to decode user details: " + invalid)
            None
          },
          valid => {
            logger.info("Successfuly requested user details.")
            Some(valid)
          }
        )
    }
  }
}
