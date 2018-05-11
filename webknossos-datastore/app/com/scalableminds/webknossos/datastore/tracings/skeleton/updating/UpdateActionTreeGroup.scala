/*
 * Copyright (C) 2011-2018 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.webknossos.datastore.tracings.skeleton.updating

import play.api.libs.json.Json


case class UpdateActionTreeGroup(name: String, groupId: String, children: List[UpdateActionTreeGroup])

object UpdateActionTreeGroup {implicit val jsonFormat = Json.format[UpdateActionTreeGroup]}
