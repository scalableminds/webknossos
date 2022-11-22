package com.scalableminds.webknossos.datastore.services

import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.DataStoreConfig
import net.liftweb.util.Helpers.tryo

import java.nio.file.{Path, Paths}
import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.sys.process._

class StorageUsageService @Inject()(config: DataStoreConfig)(implicit ec: ExecutionContext) extends FoxImplicits {

  private val baseDir: Path = Paths.get(config.Datastore.baseFolder)

  def measureStorage(organizationName: String)(implicit ec: ExecutionContext): Fox[Long] = {
    val organizationDir = baseDir.resolve(organizationName)
    for {
      duOutput: String <- tryo(s"du -s -k $organizationDir".!!.trim).toFox ?~> "failed to run du to measure storage"
      sizeKibiBytesStr <- duOutput.split("\\s+").headOption ?~> "failed to parse du output"
      sizeKibiBytes <- tryo(sizeKibiBytesStr.toLong) ?~> "failed to parse du output as number"
    } yield sizeKibiBytes * 1024
  }

}
