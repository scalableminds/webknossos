package com.scalableminds.webknossos.datastore.storage

import com.scalableminds.util.enumeration.ExtendedEnumeration

object CredentialType extends ExtendedEnumeration {
  type CredentialType = Value

  val HttpBasicAuth, HttpToken, S3AccessKey, GoogleServiceAccount = Value
}
