package e2e

import com.scalableminds.util.io.{PathUtils, ZipIO}
import com.typesafe.config.{ConfigFactory, ConfigIncludeContext, ConfigIncluder, ConfigObject, ConfigParseOptions}
import com.typesafe.scalalogging.LazyLogging
import org.scalatestplus.play.guice.*
import org.specs2.main.Arguments
import org.specs2.mutable.*
import play.api.Configuration
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.ws.{WSClient, WSResponse}
import play.api.test.WithServer

import java.io.File
import java.nio.file.Path
import scala.concurrent.Await
import scala.concurrent.duration.*
import scala.sys.process.*

class End2EndSpec(arguments: Arguments) extends Specification with GuiceFakeApplicationFactory with LazyLogging {

  private val argumentMapRead = parseCustomJavaArgs(arguments)
  // Ports differ from the dev defaults (9000/9001 for vite/backend, 7155 for fossildb)
  // so that the e2e tests can run while a local dev instance is running.
  private val testPort = 9010
  private val testUri = s"http://localhost:$testPort"
  private val testFossilDbPort = 7156 // see .github/docker-compose.yml
  private val argumentMap = argumentMapRead +
    ("http.port" -> testPort) +
    // The datastore/tracingstore uris are substituted from http.uri when the config file is loaded, so they need explicit overrides
    ("http.uri" -> testUri) +
    ("datastore.publicUri" -> testUri) +
    ("datastore.webKnossos.uri" -> testUri) +
    ("tracingstore.publicUri" -> testUri) +
    ("tracingstore.webKnossos.uri" -> testUri) +
    ("tracingstore.fossildb.port" -> testFossilDbPort) +
    ("features.voxelyticsEnabled" -> true)

  private val application =
    new GuiceApplicationBuilder().loadConfig(configWithoutLocalOverrides).configure(argumentMap).build()

  private val ws: WSClient = application.injector.instanceOf[WSClient]

  "my application" should {

    "pass the e2e tests" in new WithServer(app = application, port = testPort) {
      override def running(): Unit = {

        ensureTestDataset()

        val resp: WSResponse = Await.result(ws.url(s"http://localhost:$testPort/api/health").get(), 2 seconds)
        resp.status === 200

        runWebdriverTests === 0
      }
    }

  }

  // Like Play's default config loading, but ignoring the developer's application.local.conf,
  // so that local dev settings don't influence the e2e tests.
  private def configWithoutLocalOverrides: Configuration = {
    val parseOptions = ConfigParseOptions.defaults().setIncluder(new SkipLocalConfIncluder(None))
    val applicationConfig = ConfigFactory.parseResources("application.conf", parseOptions)
    Configuration(
      ConfigFactory
        .defaultOverrides()
        .withFallback(applicationConfig)
        .withFallback(ConfigFactory.defaultReference())
        .resolve()
    )
  }

  private class SkipLocalConfIncluder(fallback: Option[ConfigIncluder]) extends ConfigIncluder {
    override def withFallback(newFallback: ConfigIncluder): ConfigIncluder =
      new SkipLocalConfIncluder(Some(fallback.map(_.withFallback(newFallback)).getOrElse(newFallback)))

    override def include(context: ConfigIncludeContext, what: String): ConfigObject =
      if (what == "application.local.conf") ConfigFactory.empty().root()
      else fallback.map(_.include(context, what)).getOrElse(ConfigFactory.empty().root())
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
    if (dataDirectory.exists()) {
      println("Deleting existing data directory Organization_X")
      PathUtils.deleteDirectoryRecursively(dataDirectory.toPath)
    }
    dataDirectory.mkdirs()
    val testDatasetZip = new File(testDatasetPath)
    if (!testDatasetZip.exists()) {
      throw new Exception("Test dataset zip file does not exist.")
    }
    // Skip unzipping if the test dataset is already present
    if (!dataDirectory.listFiles().exists(_.getName == "test-dataset"))
      ZipIO.unzipToDirectory(
        testDatasetZip,
        Path.of(dataDirectory.toPath.toString, "test-dataset"),
        includeHiddenFiles = true,
        hiddenFilesWhitelist = List(),
        truncateCommonPrefix = true,
        boundaryDirNames = None
      )

    // Test if the dataset was unzipped successfully
    if (!dataDirectory.listFiles().exists(_.getName == "test-dataset")) {
      throw new Exception("Test dataset was not unzipped successfully.")
    }
    val testFile = new File(dataDirectory, "test-dataset/datasource-properties.json")
    if (!testFile.exists()) {
      throw new Exception("Required file does not exist.")
    }
    val testFileSource = scala.io.Source.fromFile(testFile)
    val testFileContent = try testFileSource.mkString
    finally testFileSource.close()
    if (testFileContent.isEmpty) {
      throw new Exception("Required file is empty.")
    }
  }

}
