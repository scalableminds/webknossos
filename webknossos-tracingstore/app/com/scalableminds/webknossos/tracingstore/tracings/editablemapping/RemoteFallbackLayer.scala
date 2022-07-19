package com.scalableminds.webknossos.tracingstore.tracings.editablemapping

import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing.ElementClass

case class RemoteFallbackLayer(organizationName: String,
                               dataSetName: String,
                               layerName: String,
                               elementClass: ElementClass)
