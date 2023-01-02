package e2e
/*

class End2EndSpec (arguments: Arguments) extends Specification with GuiceFakeApplicationFactory with LazyLogging {

  private val argumentMapRead = parseCustomJavaArgs(arguments)
  private val testPort = 9000
  private val argumentMap = argumentMapRead +
                 ("http.port"    -> testPort)

  private val application = new GuiceApplicationBuilder().configure(argumentMap).build()

  private val ws: WSClient = application.injector.instanceOf[WSClient]

  "my application" should {

    "pass the e2e tests" in new WithServer(
      app = application,
      port = testPort) {

      val resp: WSResponse = Await.result(ws.url(s"http://localhost:$testPort").get(), 2 seconds)
      resp.status === 200

      runWebdriverTests === 0
    }

  }

  private def runWebdriverTests = "yarn test-e2e".run().exitValue()

  private def parseCustomJavaArgs(arguments: Arguments) = {
    val argumentsString = arguments.commandLine.arguments
    val customArgumentsMap = argumentsString.filter(_.startsWith("-D")).map(_.split("="))
    customArgumentsMap.groupBy(_(0).substring(2)).mapValues(_(0).last)
  }

}
 */
