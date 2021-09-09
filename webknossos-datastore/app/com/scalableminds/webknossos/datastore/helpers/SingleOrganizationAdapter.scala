package com.scalableminds.webknossos.datastore.helpers

import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.models.datasource.DataSource
import com.typesafe.scalalogging.LazyLogging

import java.nio.file.Path

trait SingleOrganizationAdapter extends LazyLogging {
  protected def isSingleOrganizationDataStore: Boolean
  protected def singleOrganizationName: String

  def resolveOrganizationFolderIfExists(path: Path, organizationName: String): Path =
    if (isSingleOrganizationDataStore) {
      path
    } else {
      path.resolve(organizationName)
    }

  protected def getSingleOrganizationName: Option[String] =
    if (isSingleOrganizationDataStore)
      assertNonEmptyName(singleOrganizationName)
    else None

  protected def replaceDataSourceOrganizationIfNeeded(dataSource: DataSource): DataSource =
    if (isSingleOrganizationDataStore) {
      dataSource.copy(id = dataSource.id.copy(team = ""))
    } else {
      dataSource
    }

  private def assertNonEmptyName(organizationName: String): Option[String] =
    if (organizationName == "") {
      logger.error("Config error: empty organization name. Please provide a non empty name")
      None
    } else {
      Some(organizationName)
    }
}

trait SingleOrganizationConfigAdapter extends SingleOrganizationAdapter {
  protected def config: DataStoreConfig

  val singleOrganizationName: String = config.Datastore.SingleOrganizationDatastore.organizationName
  val isSingleOrganizationDataStore: Boolean = config.Datastore.SingleOrganizationDatastore.enabled
}
