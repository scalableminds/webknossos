/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.models

import play.api.libs.json._

/*
Note: This case class is not (de)serialized to/from JSON using the build-in JSON library
      but dedicated classes (MappingParser / MappingPrinter) for performance reasons.
      Whenever this class is changed, the parser and printer need to be changed accordingly.
*/

case class DataLayerMapping(name: String, parent: Option[String], path: Option[String], classes: Option[List[List[Long]]])

object DataLayerMapping {
  implicit val dataLayerMappingFormat = Json.format[DataLayerMapping]
}
