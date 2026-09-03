package backend

import com.scalableminds.util.tools.JsonAutoFormat
import com.scalableminds.util.tools.JsonHelper
import org.scalatest.wordspec.AsyncWordSpec
import play.api.libs.json.Json

class JsonAutoFormatTestSuite extends AsyncWordSpec {

  case class ExampleClass(requiredKey: String, optionalKey: Option[String] = None) derives JsonAutoFormat

  case class InnerExample(name: String, value: Int) derives JsonAutoFormat

  case class OuterExample(
      label: String,
      inner: InnerExample,
      innerOpt: Option[InnerExample] = None,
      innerList: List[InnerExample] = List.empty
  ) derives JsonAutoFormat

  "JsonAutoFormat for Option fields" should {

    "parse the key correctly if present" in {
      val jsonString = """{"requiredKey": "a", "optionalKey": "b"}"""
      val validatedBox = JsonHelper.parseAs[ExampleClass](jsonString)
      assert(validatedBox.isDefined)
      assert(validatedBox.exists(_.optionalKey.contains("b")))
    }

    "parse the key correctly if absent" in {
      val jsonString = """{"requiredKey": "a"}"""
      val validatedBox = JsonHelper.parseAs[ExampleClass](jsonString)
      assert(validatedBox.isDefined)
      assert(validatedBox.exists(_.optionalKey.isEmpty))
    }

    "parse the key as None if explicitly null (no tristate distinction)" in {
      val jsonString = """{"requiredKey": "a", "optionalKey": null}"""
      val validatedBox = JsonHelper.parseAs[ExampleClass](jsonString)
      assert(validatedBox.isDefined)
      assert(validatedBox.exists(_.optionalKey.isEmpty))
    }

    "in writing, omit the key for None" in {
      val value = ExampleClass("a", None)
      val jsonString = Json.stringify(Json.toJson(value))
      assert(jsonString == """{"requiredKey":"a"}""")
    }

    "in writing, include the key for Some" in {
      val value = ExampleClass("a", Some("b"))
      val jsonString = Json.stringify(Json.toJson(value))
      assert(jsonString == """{"requiredKey":"a","optionalKey":"b"}""")
    }

    "round-trip a value with the optional key present" in {
      val value = ExampleClass("a", Some("b"))
      assert(Json.toJson(value).as[ExampleClass] == value)
    }

    "round-trip a value with the optional key absent" in {
      val value = ExampleClass("a", None)
      assert(Json.toJson(value).as[ExampleClass] == value)
    }
  }

  "JsonAutoFormat for case classes nesting other JsonAutoFormat-derived case classes" should {

    "write a nested case class as a nested JSON object" in {
      val value = OuterExample("l", InnerExample("n", 1))
      val jsonString = Json.stringify(Json.toJson(value))
      assert(jsonString == """{"label":"l","inner":{"name":"n","value":1},"innerList":[]}""")
    }

    "round-trip a required nested case class" in {
      val value = OuterExample("l", InnerExample("n", 1))
      assert(Json.toJson(value).as[OuterExample] == value)
    }

    "round-trip an optional nested case class when present" in {
      val value = OuterExample("l", InnerExample("n", 1), innerOpt = Some(InnerExample("m", 2)))
      assert(Json.toJson(value).as[OuterExample] == value)
    }

    "round-trip an optional nested case class when absent" in {
      val value = OuterExample("l", InnerExample("n", 1), innerOpt = None)
      val json = Json.toJson(value)
      assert(json.as[OuterExample] == value)
      assert(!Json.stringify(json).contains("innerOpt"))
    }

    "round-trip a list of nested case classes" in {
      val value = OuterExample("l", InnerExample("n", 1), innerList = List(InnerExample("a", 1), InnerExample("b", 2)))
      assert(Json.toJson(value).as[OuterExample] == value)
    }

    "parse a nested case class from a raw JSON string" in {
      val jsonString =
        """{"label":"l","inner":{"name":"n","value":1},"innerOpt":{"name":"m","value":2},"innerList":[]}"""
      val validatedBox = JsonHelper.parseAs[OuterExample](jsonString)
      assert(validatedBox.isDefined)
      assert(validatedBox.exists(_.inner == InnerExample("n", 1)))
      assert(validatedBox.exists(_.innerOpt.contains(InnerExample("m", 2))))
    }
  }

}
