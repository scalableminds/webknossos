/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.datastore.tracings

import play.api.libs.json.Json

case class TracingSelector(tracingId: String, version: Option[Long] = None)

object TracingSelector {implicit val jsonFormat = Json.format[TracingSelector]}
