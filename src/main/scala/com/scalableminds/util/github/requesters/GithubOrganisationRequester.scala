/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.util.github.requesters

import com.scalableminds.util.github.ResultSet
import com.scalableminds.util.github.models.GithubOrganisation
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.Reads._
import play.api.libs.json._

trait GithubOrganisationRequester extends GithubRequester {

  val organisationsUrl: String

  def listOrgs(token: String) =
    new ResultSet(organisationsUrl, extractOrganisations, token).results.map {
      _.flatten.map(_.login)
    }

  val extractOrganisations = (__).read(list[GithubOrganisation])
}
