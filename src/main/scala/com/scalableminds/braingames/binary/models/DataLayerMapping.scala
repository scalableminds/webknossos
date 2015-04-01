/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.models

import play.api.libs.json._

case class DataLayerMapping(name: String, parent: Option[String], path: Option[String], classes: Option[List[List[Long]]])

object DataLayerMapping {
  implicit val dataLayerMappingFormat = Json.format[DataLayerMapping]
}
