/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.datastore.tracings

import com.scalableminds.util.tools.Fox
import com.trueaccord.scalapb.{GeneratedMessage, Message}
import play.api.libs.json._

trait UpdateAction[T <: GeneratedMessage with Message[T]] {
  def applyTo(tracing: T, service: TracingService[T]): Fox[T]
}

trait UpdateActionGroup[T <: GeneratedMessage with Message[T]] {

  def version: Long

  def timestamp: Long

  def actions: List[UpdateAction[T]]

  def stats: Option[JsObject]
}
