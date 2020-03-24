package com.scalableminds.webknossos.datastore.dataformats

import com.scalableminds.webknossos.datastore.models.BucketPosition
import com.scalableminds.webknossos.datastore.models.datasource.DataLayer
import net.liftweb.common.Box

trait Cube extends SafeCachable {

  def cutOutBucket(dataLayer: DataLayer, bucket: BucketPosition): Box[Array[Byte]]

}
