package com.scalableminds.webknossos.datastore.services.uploading

import com.scalableminds.util.enumeration.ExtendedEnumeration;

object UploadDomain extends ExtendedEnumeration {
  type UploadDomain = Value
  val dataset, mag, attachment = Value
}
