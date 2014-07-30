/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.util.github

import com.scalableminds.util.github.requesters._

object GithubApi
  extends GithubOrganisationRequester
  with GithubRepositoryRequester
  with GithubCollaboratorRequester
  with GithuIssueRequester
  with GithubHooksRequester
  with GithuUserDetailRequester{

  def hooksUrl(repo: String) = s"/repos/$repo/hooks"

  val organisationsUrl = "/user/orgs"

  val userUrl = "/user"

  val userRepositoriesUrl = "/user/repos"

  def repoCollaboratorsUrl(repo: String): String = s"/repos/$repo/collaborators"

  def organisationRepositoriesUrl(org: String) = s"/orgs/$org/repos"

  def issuesUrl(repo: String) = s"/repos/$repo/issues?state=all"
}
