package com.scalableminds.webknossos.datastore.datareaders.zarr3

import com.scalableminds.util.tools.AutoJsonFormat

case class ExtensionDataTypeFallback(
    name: String,
    configuration: Option[Map[String, String]]
) derives AutoJsonFormat

case class ExtensionDataType(
    name: String,
    configuration: Map[String, String],
    fallback: Option[Seq[ExtensionDataTypeFallback]]
) derives AutoJsonFormat

// This needs to replaced with concrete extensions (as with codecs)
case class ExtensionChunkGridSpecification(
    name: String,
    configuration: Option[Map[String, String]]
) derives AutoJsonFormat
