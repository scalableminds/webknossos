/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.util.github.requesters

import com.scalableminds.util.github.ResultSet
import com.scalableminds.util.github.models.GithubRepository
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.Reads._
import play.api.libs.json._

import scala.concurrent.Future

trait GithubRepositoryRequester extends GithubOrganisationRequester {

  def userRepositoriesUrl: String

  def organisationRepositoriesUrl(orga: String): String

  def listAllUserRepositories(token: String) = {
    for {
      organisations <- listOrgs(token)
      organisationRepositories <- Future.traverse(organisations)(org => listOrganisationRepositories(token, org))
      userRepositories <- listUserRepositories(token)
    } yield (userRepositories :: organisationRepositories).flatten
  }

  def listUserRepositories(token: String) =
    new ResultSet(userRepositoriesUrl, extractRepositories, token).results.map {
      results =>
        results.flatten
    }

  def listOrganisationRepositories(token: String, orga: String) = {
    new ResultSet(organisationRepositoriesUrl(orga), extractRepositories, token).results.map {
      results =>
        results.flatten
    }
  }

  val extractRepositories = (__).read(list[GithubRepository])
}
