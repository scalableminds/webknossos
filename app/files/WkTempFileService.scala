package files

import com.scalableminds.webknossos.tracingstore.cleanup.CleanUpService
import com.scalableminds.webknossos.tracingstore.files.TempFileService

import javax.inject.Inject

import scala.concurrent.ExecutionContext

class WkTempFileService @Inject()(val cleanUpService: CleanUpService)(implicit val ec: ExecutionContext)
    extends TempFileService {
  override def moduleName = "webknossos"
}
