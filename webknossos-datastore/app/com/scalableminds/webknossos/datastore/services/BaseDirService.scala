package com.scalableminds.webknossos.datastore.services

import java.nio.file.{Files, Path, Paths}

import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.models.datasource.{DataSource, DataSourceId}
import javax.inject.Inject

class BaseDirService @Inject()(config: DataStoreConfig) {
  val baseDirs = config.Braingames.Binary.baseFolders.map(Paths.get(_))

  val defaultBaseDir = baseDirs.headOption.getOrElse { throw new Exception("At least one data base directory needs to be specified") }


  def baseDirFor(dataSource: DataSource): Path = {
    baseDirFor(dataSource.id)
  }

  def baseDirFor(dataSourceId: DataSourceId): Path = {
    baseDirs.find(baseDir => Files.exists(baseDir.resolve(dataSourceId.team).resolve(dataSourceId.name))).getOrElse(baseDirs.headOption.get)
  }
}
