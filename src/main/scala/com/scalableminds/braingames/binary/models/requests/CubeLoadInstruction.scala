/*
* Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
*/
package com.scalableminds.braingames.binary.models.requests

import java.nio.file.Path

import com.scalableminds.braingames.binary.models.CubePosition
import com.scalableminds.braingames.binary.models.datasource.{DataLayer, DataSource}

case class CubeLoadInstruction(
                                baseDir: Path,
                                dataSource: DataSource,
                                dataLayer: DataLayer,
                                position: CubePosition
                              )
