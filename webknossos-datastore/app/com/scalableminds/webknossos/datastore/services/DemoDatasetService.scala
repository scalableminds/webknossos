package com.scalableminds.webknossos.datastore.services

import com.google.inject.Inject
import scala.concurrent.ExecutionContext.Implicits.global
import com.scalableminds.util.tools.Fox

class DemoDatasetService @Inject()() {
  def initDownload(organizationName: String) = {
    Fox.successful()
  }
}
