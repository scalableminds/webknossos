/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.webknossos.datastore.tracings.skeleton.updating

import play.api.libs.json.Json

case class UpdateActionComment(nodeId: Int, content: String)

object UpdateActionComment {implicit val jsonFormat = Json.format[UpdateActionComment]}
