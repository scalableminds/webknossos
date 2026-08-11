package backend

import com.scalableminds.util.tools.MathUtils
import com.scalableminds.webknossos.datastore.helpers.UnsignedLong
import com.scalableminds.webknossos.tracingstore.tracings.volume.{
  CreateSegmentVolumeAction,
  MergeSegmentItemsVolumeAction,
  UpdateActiveSegmentIdVolumeAction
}
import org.scalatest.wordspec.AsyncWordSpec
import play.api.libs.json.{JsNumber, JsObject, JsString, JsSuccess, Json}

class UnsignedLongTestSuite extends AsyncWordSpec {

  "UnsignedLong.writes" should {
    "encode values within the legacy safe-integer range as a tagged bigint envelope" in
      assert(
        Json.toJson(UnsignedLong(12345L)) ==
          Json.obj("customJsonEncoding" -> "bigint", "value" -> "12345")
      )
    "encode values above Long.MaxValue's bit pattern as the correct large unsigned string" in {
      // -1L is the bit pattern for 2^64 - 1 when interpreted as unsigned
      assert(
        Json.toJson(UnsignedLong(-1L)) ==
          Json.obj("customJsonEncoding" -> "bigint", "value" -> "18446744073709551615")
      )
      // Long.MinValue's bit pattern is 2^63 when interpreted as unsigned
      assert(
        Json.toJson(UnsignedLong(Long.MinValue)) ==
          Json.obj("customJsonEncoding" -> "bigint", "value" -> "9223372036854775808")
      )
    }
  }

  "UnsignedLong reads" should {
    "parse the tagged bigint envelope, round-tripping the exact bit pattern" in {
      assert(
        Json
          .obj("customJsonEncoding" -> "bigint", "value" -> "18446744073709551615")
          .validate[UnsignedLong] == JsSuccess(
          UnsignedLong(-1L)
        )
      )
      assert(
        Json.obj("customJsonEncoding" -> "bigint", "value" -> "9223372036854775808").validate[UnsignedLong]
          == JsSuccess(UnsignedLong(Long.MinValue))
      )
      assert(
        Json.obj("customJsonEncoding" -> "bigint", "value" -> "42").validate[UnsignedLong] == JsSuccess(
          UnsignedLong(42L)
        )
      )
    }
    "parse the legacy plain JsNumber encoding (permanent backward compatibility)" in {
      assert(JsNumber(42).validate[UnsignedLong] == JsSuccess(42L))
      assert(JsNumber(0).validate[UnsignedLong] == JsSuccess(0L))
    }
    "fail on malformed input" in {
      assert(JsString("not-a-number").validate[UnsignedLong].isError)
      assert(Json.obj().validate[UnsignedLong].isError)
      assert(
        Json.obj("customJsonEncoding" -> "bigint", "value" -> "not-a-number").validate[UnsignedLong].isError
      )
      assert(Json.obj("customJsonEncoding" -> "somethingElse").validate[UnsignedLong].isError)
    }
  }

  "UnsignedLong-patched action formats" should {
    "round-trip a segment id above 2^53 as a tagged bigint envelope, leaving other Long fields as JsNumber" in {
      val action = CreateSegmentVolumeAction(
        id = UnsignedLong((1L << 60) + 7L),
        anchorPosition = None,
        name = None,
        color = None,
        groupId = None,
        creationTime = Some(1234567890L),
        actionTracingId = "someTracingId"
      )
      val json = Json.toJson(action)
      assert(
        (json \ "id").as[JsObject] ==
          Json.obj("customJsonEncoding" -> "bigint", "value" -> java.lang.Long.toUnsignedString((1L << 60) + 7L))
      )
      // creationTime is a timestamp, not an id, and must keep the default JsNumber encoding.
      assert((json \ "creationTime").as[Long] == 1234567890L)

      val parsedBack = json.validate[CreateSegmentVolumeAction]
      assert(parsedBack == JsSuccess(action))
    }

    "round-trip an id above Long.MaxValue's bit pattern (true uint64 range)" in {
      val action = UpdateActiveSegmentIdVolumeAction(
        activeSegmentId = UnsignedLong(-1L), // 2^64 - 1
        actionTracingId = "someTracingId"
      )
      val json = Json.toJson(action)
      assert(
        (json \ "activeSegmentId").as[JsObject] ==
          Json.obj("customJsonEncoding" -> "bigint", "value" -> "18446744073709551615")
      )
      assert(json.validate[UpdateActiveSegmentIdVolumeAction] == JsSuccess(action))
    }

    "accept legacy plain-JsNumber-encoded ids for backward compatibility with persisted update actions" in {
      val legacyJson = Json.obj(
        "agglomerateId1" -> 111,
        "agglomerateId2" -> 222,
        "segmentId1" -> 333,
        "segmentId2" -> 444,
        "actionTracingId" -> "someTracingId"
      )
      val parsed = legacyJson.validate[MergeSegmentItemsVolumeAction]
      assert(
        parsed == JsSuccess(
          MergeSegmentItemsVolumeAction(
            agglomerateId1 = UnsignedLong(111L),
            agglomerateId2 = UnsignedLong(222L),
            segmentId1 = UnsignedLong(333L),
            segmentId2 = UnsignedLong(444L),
            actionTracingId = "someTracingId"
          )
        )
      )
    }

    "reject a segment id field that is neither a JsString nor a JsNumber" in {
      val badJson = Json.obj(
        "id" -> Json.obj("nested" -> "object"),
        "actionTracingId" -> "someTracingId"
      )
      assert(badJson.validate[CreateSegmentVolumeAction](using CreateSegmentVolumeAction.jsonFormat).isError)
    }
  }

  "MathUtils.maxUnsignedUnsigned/minUnsigned" should {
    "agree with signed max/min when both values are non-negative" in {
      assert(MathUtils.maxUnsigned(5L, 12L) == 12L)
      assert(MathUtils.minUnsigned(5L, 12L) == 5L)
    }
    "treat a negative bit pattern as the larger uint64 value" in {
      // -1L's bit pattern is 2^64 - 1, the largest possible uint64 value.
      assert(MathUtils.maxUnsigned(-1L, 5L) == -1L)
      assert(MathUtils.minUnsigned(-1L, 5L) == 5L)
      // Long.MinValue's bit pattern is 2^63, also larger than any non-negative Long.
      assert(MathUtils.maxUnsigned(Long.MinValue, Long.MaxValue) == Long.MinValue)
      assert(MathUtils.minUnsigned(Long.MinValue, Long.MaxValue) == Long.MaxValue)
    }
    "return either argument when both are equal" in {
      assert(MathUtils.maxUnsigned(7L, 7L) == 7L)
      assert(MathUtils.minUnsigned(7L, 7L) == 7L)
    }
  }

}
