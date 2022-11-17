package com.scalableminds.webknossos.datastore.services

import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.DataStoreConfig

import java.nio.file.{Path, Paths}
import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.sys.process._

class StorateUsageService  @Inject()(config: DataStoreConfig) {

  private val baseDir: Path = Paths.get(config.Datastore.baseFolder)

  def measureStorage(organizationName: String)(implicit ec: ExecutionContext): Fox[Long] = {
    val organizationDir = baseDir.resolve(organizationName)
    val duOutput: String = s"du -s ---block-size=1 $organizationDir".!!.trim
    println(duOutput)

    Fox.successful(1234L)
  }

}
