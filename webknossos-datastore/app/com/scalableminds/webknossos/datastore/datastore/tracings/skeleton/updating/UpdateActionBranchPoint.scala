/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.webknossos.datastore.datastore.tracings.skeleton.updating

import play.api.libs.json.Json


case class UpdateActionBranchPoint(nodeId: Int, timestamp: Long)

object UpdateActionBranchPoint {implicit val jsonFormat = Json.format[UpdateActionBranchPoint]}
