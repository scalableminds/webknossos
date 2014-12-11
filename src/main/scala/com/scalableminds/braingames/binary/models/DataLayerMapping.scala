/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.models

import play.api.libs.json._

case class DataLayerMapping(name: String, path: String)

object DataLayerMapping {
  implicit val dataLayerMappingFormat = Json.format[DataLayerMapping]
}
