package com.scalableminds.webknossos.datastore.datareaders.zarr3

case class ExtensionDataType(
    name: String,
    configuration: Any,
    fallback: Option[Seq[ExtensionDataTypeFallback]]
)

case class ExtensionDataTypeFallback(
    name: String,
    configuration: Option[Any]
)

case class ExtensionChunkGridSpecification(
    name: String,
    configuration: Option[Any]
)
