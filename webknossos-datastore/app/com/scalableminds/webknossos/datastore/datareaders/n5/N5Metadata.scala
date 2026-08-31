package com.scalableminds.webknossos.datastore.datareaders.n5

import com.scalableminds.util.tools.AutoJsonFormat

case class N5Metadata(multiscales: List[N5MultiscalesItem]) derives AutoJsonFormat

case class N5MultiscalesItem(datasets: List[N5MultiscalesDataset]) derives AutoJsonFormat

case class N5MultiscalesDataset(path: String, transform: N5Transform) derives AutoJsonFormat

case class N5Transform(axes: List[String], scale: List[Double], units: Option[List[String]]) derives AutoJsonFormat

object N5Metadata {
  val FILENAME_ATTRIBUTES_JSON = "attributes.json"
}

// Below are the classes used for the more “compact” multiscales metadata as described in https://github.com/google/neuroglancer/blob/master/src/datasource/n5/index.rst
// Note: only metadata with downsamplingFactors (or scales) in the toplevel are supported at the moment.

case class N5CompactMultiscalesMetadata(
    axes: Option[List[String]],
    downsamplingFactors: Option[List[List[Int]]],
    scales: Option[List[List[Int]]],
    multiScale: Option[Boolean],
    resolution: List[Double],
    units: Option[List[String]]
) derives AutoJsonFormat
