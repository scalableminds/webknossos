package com.scalableminds.webknossos.datastore.services

import java.util.concurrent.atomic.AtomicBoolean

import akka.stream.scaladsl.Source
import akka.util.ByteString
import com.google.inject.Inject

import scala.concurrent.ExecutionContext.Implicits.global
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.rpc.RPC

class DemoDatasetService @Inject()(
                                    rpc: RPC) {
  var isDownloadRunning = new AtomicBoolean(false)

  def initDownload(organizationName: String): Fox[Unit] = {
    if (isDownloadRunning.compareAndSet(false, true)) {
      download
      Fox.successful()
    } else {
      Fox.failure("alreadyRunning")
    }
  }

  def download: Fox[Unit] = {
    for {
      response <- rpc("https://localhost/cremi.zip").get
      bytes = response.bodyAsBytes
      _ = isDownloadRunning.set(false)
    } yield ()
  }

}
