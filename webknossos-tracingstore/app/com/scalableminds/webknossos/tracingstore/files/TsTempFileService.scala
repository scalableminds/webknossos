package com.scalableminds.webknossos.tracingstore.files

import com.scalableminds.webknossos.tracingstore.cleanup.CleanUpService

import javax.inject.Inject
import scala.concurrent.ExecutionContext

class TsTempFileService @Inject()(val cleanUpService: CleanUpService)(implicit val ec: ExecutionContext)
    extends TempFileService {
  override def moduleName = "webknossos-tracingstore"
}
