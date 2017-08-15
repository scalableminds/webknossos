package com.scalableminds.braingames.datastore.tracings

import net.liftweb.common.{Box, Full}
import play.api.libs.json.{JsObject, Json}

trait UpdateAction[T <: Tracing] {
  def applyTo(tracing: T): Box[T] = Full(tracing)
}

trait UpdateActionGroup[T <: Tracing] {

  def version: Long

  def timestamp: Long

  def actions: List[UpdateAction[T]]

  def stats: Option[JsObject] = None
}
