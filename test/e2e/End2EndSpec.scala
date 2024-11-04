package e2e

import com.scalableminds.util.io.ZipIO
import com.typesafe.scalalogging.LazyLogging
import org.scalatestplus.play.guice._
import org.specs2.main.Arguments
import org.specs2.mutable._
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.ws.{WSClient, WSResponse}
import play.api.test.WithServer

import java.io.File
import java.nio.file.Paths
import scala.concurrent.Await
import scala.concurrent.duration._
import scala.sys.process._

class End2EndSpec(arguments: Arguments) extends Specification with GuiceFakeApplicationFactory with LazyLogging {

  private val argumentMapRead = parseCustomJavaArgs(arguments)
  private val testPort = 9000
  private val argumentMap = argumentMapRead +
    ("http.port" -> testPort)

  private val application = new GuiceApplicationBuilder().configure(argumentMap).build()

  private val ws: WSClient = application.injector.instanceOf[WSClient]

  "my application" should {

    "pass the e2e tests" in new WithServer(app = application, port = testPort) {

      ensureTestDataset()

      val resp: WSResponse = Await.result(ws.url(s"http://localhost:$testPort").get(), 2 seconds)
      resp.status === 200

      runWebdriverTests === 0
    }

  }

  private def runWebdriverTests = "yarn test-e2e".run().exitValue()

  private def parseCustomJavaArgs(arguments: Arguments) = {
    val argumentsString = arguments.commandLine.arguments
    val customArgumentsMap = argumentsString.filter(_.startsWith("-D")).map(_.split("="))
    customArgumentsMap.groupBy(_(0).substring(2)).view.mapValues(_(0).last).toMap
  }

  private def ensureTestDataset(): Unit = {
    val testDatasetPath = "test/dataset/test-dataset.zip"
    val dataDirectory = new File("binaryData/Organization_X")
    if (!dataDirectory.exists()) {
      dataDirectory.mkdirs()
    }
    val testDatasetZip = new File(testDatasetPath)
    if (!testDatasetZip.exists()) {
      throw new Exception("Test dataset zip file does not exist.")
    }
    // Skip unzipping if the test dataset is already present
    if (!dataDirectory.listFiles().exists(_.getName == "test-dataset"))
      ZipIO.unzipToFolder(
        testDatasetZip,
        Paths.get(dataDirectory.toPath.toString, "test-dataset"),
        includeHiddenFiles = true,
        hiddenFilesWhitelist = List(),
        truncateCommonPrefix = true,
        excludeFromPrefix = None
      )
  }

}
