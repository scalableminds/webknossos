/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.dataformats.wkw

import java.nio.file.Path

import com.scalableminds.braingames.binary.`import`.{DataSourceImportReport, DataSourceImporter}
import com.scalableminds.braingames.binary.models.datasource.DataLayer
import net.liftweb.common.{Box, Empty}

object WKWDataFormat extends DataSourceImporter {
  val dataFileExtension = "wkw"

  def exploreLayer(name: String, baseDir: Path, previous: Option[DataLayer])(implicit report: DataSourceImportReport[Path]): Box[DataLayer] = Empty
}
