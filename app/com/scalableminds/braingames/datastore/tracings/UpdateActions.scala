/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.datastore.tracings

import net.liftweb.common.{Box, Full}
import play.api.libs.json.JsObject

trait UpdateAction[T <: Tracing] {
  def applyTo(tracing: T): Box[T] = Full(tracing)
}

trait UpdateActionGroup[T <: Tracing] {

  def version: Long

  def timestamp: Long

  def actions: List[UpdateAction[T]]

  def stats: Option[JsObject] = None
}
