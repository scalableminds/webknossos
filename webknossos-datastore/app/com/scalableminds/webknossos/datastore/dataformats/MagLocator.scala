package com.scalableminds.webknossos.datastore.dataformats

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.AutoFormat
import com.scalableminds.webknossos.datastore.datareaders.AxisOrder
import com.scalableminds.webknossos.datastore.helpers.UPath
import com.scalableminds.webknossos.datastore.models.datasource.MagFormatHelper
import com.scalableminds.webknossos.datastore.storage.LegacyDataVaultCredential

case class MagLocator(
    mag: Vec3Int,
    path: Option[UPath] = None,
    credentials: Option[LegacyDataVaultCredential] = None,
    axisOrder: Option[AxisOrder] = None,
    channelIndex: Option[Int] = None,
    credentialId: Option[String] = None
) derives AutoFormat {

  def withoutCredentials: MagLocator = this.copy(credentials = None, credentialId = None)
}

object MagLocator extends MagFormatHelper
