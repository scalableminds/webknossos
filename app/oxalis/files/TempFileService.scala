package oxalis.files

import java.io.File
import java.nio.file.Paths

import com.scalableminds.util.tools.Fox
import javax.inject.Inject
import net.liftweb.common.Box.tryo
import oxalis.cleanup.CleanUpService

class TempFileService @Inject()(cleanUpService: CleanUpService) {

  private val tmpDir: String = System.getenv("java.io.tmpdir")

  private val activeTempFiles = scala.collection.mutable.Set[File]()

  cleanUpService.register("Clean up temporary files", cleanUp)

  def create(prefix: String = ""): File = {
    Paths.get(tmpDir)
  }

  def cleanUp(): Unit = {
    activeTempFiles.foreach { f =>
      tryo(f.delete())
    }
    Fox.successful()
  }
}
