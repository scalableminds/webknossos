package com.scalableminds.braingames.datastore.tracings.skeleton.elements

import play.api.libs.json.Json

/**
  * Created by f on 15.06.17.
  */
case class Edge(
  source: Int,
  target: Int)

object Edge {implicit val jsonFormat = Json.format[Edge]}
