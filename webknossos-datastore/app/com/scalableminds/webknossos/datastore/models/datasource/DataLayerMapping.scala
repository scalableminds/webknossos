package com.scalableminds.webknossos.datastore.models.datasource

/*
Note: This case class is not (de)serialized to/from JSON using the build-in JSON library
      but instead uses the dedicated MappingParser class for performance reasons.
      Whenever this data class is changed, the parser needs to be modified accordingly.
 */

// This trait is needed so that DataLayerMappings of different data types can be stored in a single common cache.
trait AbstractDataLayerMapping

case class DataLayerMapping[T](name: String, mapping: Map[T, T]) extends AbstractDataLayerMapping
