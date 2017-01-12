package com.scalableminds.util.github.models

import play.api.libs.json.Json

/**
  * Created by tmbo on 10.01.17.
  */
case class GithubMilestone(title: String, description: String, id: Int, number: Int)

object GithubMilestone{
  implicit val githubMilestoneFormat = Json.format[GithubMilestone]
}
