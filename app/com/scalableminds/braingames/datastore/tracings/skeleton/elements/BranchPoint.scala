package com.scalableminds.braingames.datastore.tracings.skeleton.elements

import play.api.libs.json.Json

/**
  * Created by f on 15.06.17.
  */
case class BranchPoint(
  id: Int,
  timestamp: Long)

object BranchPoint {implicit val jsonFormat = Json.format[BranchPoint]}
