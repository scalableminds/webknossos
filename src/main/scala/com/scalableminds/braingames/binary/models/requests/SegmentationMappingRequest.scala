/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.models.requests

import com.scalableminds.braingames.binary.models.datasource.{DataLayer, DataSource}

case class SegmentationMappingRequest(
                                       dataSource: DataSource,
                                       dataLayer: DataLayer,
                                       segmentationMapping: String
                                     )
