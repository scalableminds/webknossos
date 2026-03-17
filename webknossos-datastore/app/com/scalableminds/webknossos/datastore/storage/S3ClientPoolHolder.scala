package com.scalableminds.webknossos.datastore.storage

import jakarta.inject.Inject
import play.api.libs.ws.WSClient

class S3ClientPoolHolder @Inject()(ws: WSClient) {
  lazy val s3ClientPool = new S3ClientPool(ws)
}
