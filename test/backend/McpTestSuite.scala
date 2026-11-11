package backend

import mcp.{EmSkillsService, JsonRpc, JsonRpcError, PythonDocsService}
import org.scalatest.wordspec.AnyWordSpec
import play.api.libs.json.{JsNull, JsNumber, JsString, Json}

class McpTestSuite extends AnyWordSpec {

  "JsonRpc.parseRequest" should {
    "parse a request with params" in {
      val parsed = JsonRpc.parseRequest(
        Json.obj("jsonrpc" -> "2.0", "id" -> 1, "method" -> "tools/call", "params" -> Json.obj("name" -> "ping"))
      )
      assert(parsed.exists(_.method == "tools/call"))
      assert(parsed.exists(_.id.contains(JsNumber(1))))
      assert(parsed.exists(request => (request.params \ "name").asOpt[String].contains("ping")))
      assert(parsed.exists(!_.isNotification))
    }

    "treat a request without id as a notification" in {
      val parsed = JsonRpc.parseRequest(Json.obj("jsonrpc" -> "2.0", "method" -> "notifications/initialized"))
      assert(parsed.exists(_.isNotification))
    }

    "accept string ids" in {
      val parsed = JsonRpc.parseRequest(Json.obj("jsonrpc" -> "2.0", "id" -> "abc", "method" -> "ping"))
      assert(parsed.exists(_.id.contains(JsString("abc"))))
    }

    "reject a null id, which MCP forbids, rather than treating it as a notification" in {
      val parsed = JsonRpc.parseRequest(Json.obj("jsonrpc" -> "2.0", "id" -> JsNull, "method" -> "ping"))
      assert(parsed.swap.exists(_.code == JsonRpcError.invalidRequestCode))
    }

    "reject ids that are neither strings nor numbers" in {
      val parsed = JsonRpc.parseRequest(Json.obj("jsonrpc" -> "2.0", "id" -> Json.obj("a" -> 1), "method" -> "ping"))
      assert(parsed.swap.exists(_.code == JsonRpcError.invalidRequestCode))
    }

    "reject a request without the jsonrpc version" in {
      assert(JsonRpc.parseRequest(Json.obj("id" -> 1, "method" -> "ping")).isLeft)
      assert(JsonRpc.parseRequest(Json.obj("jsonrpc" -> "1.0", "id" -> 1, "method" -> "ping")).isLeft)
    }

    "reject positional params" in {
      val parsed =
        JsonRpc.parseRequest(Json.obj("jsonrpc" -> "2.0", "id" -> 1, "method" -> "tools/call", "params" -> Json.arr(1)))
      assert(parsed.swap.exists(_.code == JsonRpcError.invalidParamsCode))
    }

    "default missing params to an empty object" in {
      val parsed = JsonRpc.parseRequest(Json.obj("jsonrpc" -> "2.0", "id" -> 1, "method" -> "tools/list"))
      assert(parsed.exists(_.params == Json.obj()))
    }

    "reject a request without a method" in {
      val parsed = JsonRpc.parseRequest(Json.obj("jsonrpc" -> "2.0", "id" -> 1))
      assert(parsed.swap.exists(_.code == JsonRpcError.invalidRequestCode))
    }

    "reject a batched request" in {
      val parsed = JsonRpc.parseRequest(Json.arr(Json.obj("jsonrpc" -> "2.0", "method" -> "ping")))
      assert(parsed.swap.exists(_.code == JsonRpcError.invalidRequestCode))
    }

    "reject a non-object request" in
      assert(JsonRpc.parseRequest(Json.toJson("ping")).isLeft)
  }

  "JsonRpc.error" should {
    "use a null id if there is none" in {
      val error = JsonRpc.error(None, JsonRpcError.methodNotFound("foo"))
      assert((error \ "id").asOpt[String].isEmpty)
      assert((error \ "error" \ "code").as[Int] == JsonRpcError.methodNotFoundCode)
      assert((error \ "error" \ "message").as[String] == "Method not found: foo")
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
