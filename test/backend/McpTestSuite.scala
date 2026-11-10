package backend

import com.fasterxml.jackson.databind.ObjectMapper
import io.modelcontextprotocol.common.McpTransportContext
import io.modelcontextprotocol.json.jackson2.JacksonMcpJsonMapper
import io.modelcontextprotocol.json.schema.jackson2.DefaultJsonSchemaValidator
import io.modelcontextprotocol.server.transport.DefaultServerTransportSecurityValidator
import io.modelcontextprotocol.server.{McpServer, McpStatelessServerFeatures}
import io.modelcontextprotocol.spec.McpSchema
import io.modelcontextprotocol.spec.McpSchema.{CallToolRequest, CallToolResult, Tool}
import mcp.{EmSkillsService, PlayMcpTransport, PythonDocsService}
import org.scalatest.wordspec.AnyWordSpec
import play.api.libs.json.{JsObject, JsValue, Json}
import play.api.mvc.{Headers, Result}
import play.api.test.Helpers.{contentAsJson, contentAsString, defaultAwaitTimeout, status}
import reactor.core.publisher.Mono

import scala.concurrent.{ExecutionContext, Future}
import scala.jdk.CollectionConverters.*

class McpTestSuite extends AnyWordSpec {

  private given ExecutionContext = ExecutionContext.global

  private val instanceOrigin = "http://localhost:9000"
  private val objectMapper = new ObjectMapper()
  private val jsonMapper = new JacksonMcpJsonMapper(objectMapper)
  private val transport = new PlayMcpTransport(
    jsonMapper,
    DefaultServerTransportSecurityValidator.builder().allowedOrigin(instanceOrigin).build()
  )
  private val context = McpTransportContext.create(Map[String, AnyRef]("user" -> "user42").asJava)

  // A tool that echoes its argument together with the user from the transport context.
  private val echoTool = new McpStatelessServerFeatures.AsyncToolSpecification(
    Tool
      .builder(
        "echo",
        jsonMapper,
        """{"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"]}"""
      )
      .build(),
    (ctx: McpTransportContext, request: CallToolRequest) =>
      Mono.just(
        CallToolResult.builder().addTextContent(s"${request.arguments().get("text")} from ${ctx.get("user")}").build()
      )
  )

  // Registers itself with the transport.
  McpServer
    .async(transport)
    .jsonMapper(jsonMapper)
    .jsonSchemaValidator(new DefaultJsonSchemaValidator(objectMapper))
    .serverInfo("test", "1.0.0")
    .capabilities(McpSchema.ServerCapabilities.builder().tools(false).build())
    .tools(echoTool)
    .build()

  private def request(id: Int, method: String, params: JsObject = Json.obj()): JsObject =
    Json.obj("jsonrpc" -> "2.0", "id" -> id, "method" -> method, "params" -> params)

  private def post(message: JsValue, headers: Headers = Headers()): Future[Result] =
    transport.handlePost(Json.stringify(message), Some("application/json"), headers, context)

  // The protocol itself is the SDK's job. These tests check that PlayMcpTransport wires it up correctly.
  "PlayMcpTransport" should {
    "answer initialize with the server info and the negotiated protocol version" in {
      val response = post(request(1, "initialize", Json.obj("protocolVersion" -> "2025-06-18")))
      assert(status(response) == 200)
      val json = contentAsJson(response)
      assert((json \ "id").as[Int] == 1)
      assert((json \ "result" \ "protocolVersion").as[String] == "2025-06-18")
      assert((json \ "result" \ "serverInfo" \ "name").as[String] == "test")
    }

    "list and call tools" in {
      val toolNames = (contentAsJson(post(request(2, "tools/list"))) \ "result" \ "tools" \\ "name").map(_.as[String])
      assert(toolNames == Seq("echo"))

      val callResponse =
        post(request(3, "tools/call", Json.obj("name" -> "echo", "arguments" -> Json.obj("text" -> "hello"))))
      assert((contentAsJson(callResponse) \ "result" \ "content" \ 0 \ "text").as[String] == "hello from user42")
    }

    "accept notifications without answering them" in {
      val response = post(Json.obj("jsonrpc" -> "2.0", "method" -> "notifications/initialized"))
      assert(status(response) == 202)
      assert(contentAsString(response).isEmpty)
    }

    "answer unknown methods with a JSON-RPC error" in {
      val json = contentAsJson(post(request(4, "foo/bar")))
      assert((json \ "id").as[Int] == 4)
      assert((json \ "error" \ "code").as[Int] == McpSchema.ErrorCodes.METHOD_NOT_FOUND)
    }

    "reject unparsable and batched messages" in {
      val unparsable = transport.handlePost("{not json", Some("application/json"), Headers(), context)
      assert(status(unparsable) == 400)
      assert((contentAsJson(unparsable) \ "error" \ "code").as[Int] == McpSchema.ErrorCodes.PARSE_ERROR)

      val batch =
        transport.handlePost(Json.stringify(Json.arr(request(5, "ping"))), Some("application/json"), Headers(), context)
      assert(status(batch) == 400)
    }

    "reject other content types" in {
      val response = transport.handlePost(Json.stringify(request(6, "ping")), Some("text/plain"), Headers(), context)
      assert(status(response) == 415)
    }

    "reject requests from foreign web pages, but not from the instance itself" in {
      assert(status(post(request(7, "ping"), Headers("Origin" -> "https://evil.example.com"))) == 403)
      assert(status(post(request(8, "ping"), Headers("Origin" -> instanceOrigin))) == 200)
    }
  }

  "EmSkillsService.isValidSkillName" should {
    "accept the skill names of the collection" in {
      assert(EmSkillsService.isValidSkillName("segneuron-inference"))
      assert(EmSkillsService.isValidSkillName("mitonet-inference"))
      assert(EmSkillsService.isValidSkillName("bootstrap-em-segmentation"))
    }

    "reject anything that could escape the repository path" in {
      // The name is interpolated into a URL under a fixed prefix.
      assert(!EmSkillsService.isValidSkillName("../../etc/passwd"))
      assert(!EmSkillsService.isValidSkillName("a/b"))
      assert(!EmSkillsService.isValidSkillName(".."))
      assert(!EmSkillsService.isValidSkillName("skill?x=1"))
      assert(!EmSkillsService.isValidSkillName("Skill"))
      assert(!EmSkillsService.isValidSkillName("-leading-dash"))
      assert(!EmSkillsService.isValidSkillName(""))
    }
  }

  "PythonDocsService.isAllowedUrl" should {
    "allow documentation pages" in {
      assert(PythonDocsService.isAllowedUrl("https://docs.webknossos.org/llms.txt"))
      assert(PythonDocsService.isAllowedUrl("https://docs.webknossos.org/api/webknossos/dataset/dataset.md"))
    }

    "reject other hosts" in {
      assert(!PythonDocsService.isAllowedUrl("https://evil.example.com/x.md"))
      assert(!PythonDocsService.isAllowedUrl("https://docs.webknossos.org.evil.com/x.md"))
      assert(!PythonDocsService.isAllowedUrl("https://evil.com/?x=https://docs.webknossos.org/llms.txt"))
    }

    "reject other schemes" in {
      assert(!PythonDocsService.isAllowedUrl("http://docs.webknossos.org/llms.txt"))
      assert(!PythonDocsService.isAllowedUrl("file:///etc/passwd"))
      assert(!PythonDocsService.isAllowedUrl("not a url"))
    }
  }
}
