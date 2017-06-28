package com.scalableminds.braingames.datastore.tracings.skeleton.elements

import play.api.libs.json.Json

/**
  * Created by f on 15.06.17.
  */
case class Comment(
  node: Int,
  content: String)

object Comment {implicit val jsonFormat = Json.format[Comment]}
