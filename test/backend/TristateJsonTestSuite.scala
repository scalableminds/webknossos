package backend

import com.scalableminds.util.tools.{JsonHelper, TristateOptionJsonHelper}
import org.scalatest.wordspec.AsyncWordSpec
import play.api.libs.json.{Json, OFormat}

class TristateJsonTestSuite extends AsyncWordSpec {

  case class ExampleClass(
      requiredKey: String,
      optionalKey: Option[String],
      tristateOptionalKey: Option[Option[String]] = Some(None)
  )

  object ExampleClass extends TristateOptionJsonHelper {
    implicit val jsonFormat: OFormat[ExampleClass] =
      Json.configured(tristateOptionParsing).format[ExampleClass]
  }

  "TristateJsonFormat" should {

    "parse the keys correctly if all are present" in {
      val jsonString = """{"requiredKey": "a", "optionalKey": "b", "tristateOptionalKey": "c"}"""
      val validatedBox = JsonHelper.parseAs[ExampleClass](jsonString)
      assert(validatedBox.isDefined)
      assert(validatedBox.exists(_.optionalKey.isDefined))
      assert(validatedBox.exists(_.tristateOptionalKey.isDefined))
      assert(validatedBox.exists(_.tristateOptionalKey.contains(Some("c"))))
    }

    "parse the keys correctly if optional and tristateOptional are absent" in {
      val jsonString = """{"requiredKey": "a"}"""
      val validatedBox = JsonHelper.parseAs[ExampleClass](jsonString)
      assert(validatedBox.isDefined)
      assert(validatedBox.exists(_.optionalKey.isEmpty))
      assert(validatedBox.exists(_.tristateOptionalKey.isEmpty))
    }

    "parse the keys correctly if optional and tristateOptional are null" in {
      val jsonString = """{"requiredKey": "a", "optionalKey": null, "tristateOptionalKey": null}"""
      val validatedBox = JsonHelper.parseAs[ExampleClass](jsonString)
      assert(validatedBox.isDefined)
      assert(validatedBox.exists(_.optionalKey.isEmpty))
      assert(validatedBox.exists(_.tristateOptionalKey.isDefined))
      assert(validatedBox.exists(_.tristateOptionalKey.contains(None)))
    }

    "in writing, write null for Some(None)" in {
      val value = ExampleClass("a", None, Some(None))
      val jsonString = Json.stringify(Json.toJson(value))
      assert(jsonString == """{"requiredKey":"a","tristateOptionalKey":null}""")
    }

    "in writing, skip key for None" in {
      val value = ExampleClass("a", None, None)
      val jsonString = Json.stringify(Json.toJson(value))
      assert(jsonString == """{"requiredKey":"a"}""")
    }

  }

}
