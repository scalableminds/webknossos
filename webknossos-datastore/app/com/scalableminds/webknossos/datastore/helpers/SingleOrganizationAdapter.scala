package com.scalableminds.webknossos.datastore.helpers

import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.models.datasource.DataSource

import java.nio.file.Path

trait SingleOrganizationAdapter {
  protected def singleOrganizationName: Option[String]

  def resolveOrganizationFolderIfExists(path: Path, organizationName: String): Path =
    singleOrganizationName match {
      case Some(_) => path
      case None    => path.resolve(organizationName)
    }

  protected def isSingleOrganizationDataStore: Boolean =
    singleOrganizationName.isDefined

  // Previously check if datastore is single organization, otherwise no guarantees on name
  protected def getSingleOrganizationName: String =
    singleOrganizationName.getOrElse("")

  protected def replaceDataSourceOrganizationIfNeeded(dataSource: DataSource): DataSource =
    singleOrganizationName match {
      case Some(_) => dataSource.copy(id = dataSource.id.copy(team = ""))
      case None    => dataSource
    }
}

trait SingleOrganizationConfigAdapter extends SingleOrganizationAdapter {
  protected def config: DataStoreConfig

  val singleOrganizationName: Option[String] = config.Datastore.SingleOrganizationDatastore.organizationName
}
