package backend

import com.scalableminds.webknossos.datastore.helpers.UnsignedLongJson
import com.scalableminds.webknossos.tracingstore.tracings.volume.{
  CreateSegmentVolumeAction,
  MergeSegmentItemsVolumeAction,
  UpdateActiveSegmentIdVolumeAction
}
import org.scalatest.wordspec.AsyncWordSpec
import play.api.libs.json.{JsNumber, JsString, JsSuccess, Json}

class UnsignedLongJsonTestSuite extends AsyncWordSpec {

  "UnsignedLongJson.writes" should {
    "encode values within the legacy safe-integer range as an unsigned-decimal string" in
      assert(UnsignedLongJson.writes.writes(12345L) == JsString("12345"))
    "encode values above Long.MaxValue's bit pattern as the correct large unsigned string" in {
      // -1L is the bit pattern for 2^64 - 1 when interpreted as unsigned
      assert(UnsignedLongJson.writes.writes(-1L) == JsString("18446744073709551615"))
      // Long.MinValue's bit pattern is 2^63 when interpreted as unsigned
      assert(UnsignedLongJson.writes.writes(Long.MinValue) == JsString("9223372036854775808"))
    }
  }

  "UnsignedLongJson.reads" should {
    "parse the new unsigned-decimal string encoding, round-tripping the exact bit pattern" in {
      assert(UnsignedLongJson.reads.reads(JsString("18446744073709551615")) == JsSuccess(-1L))
      assert(UnsignedLongJson.reads.reads(JsString("9223372036854775808")) == JsSuccess(Long.MinValue))
      assert(UnsignedLongJson.reads.reads(JsString("42")) == JsSuccess(42L))
    }
    "parse the legacy plain JsNumber encoding (permanent backward compatibility)" in {
      assert(UnsignedLongJson.reads.reads(JsNumber(42)) == JsSuccess(42L))
      assert(UnsignedLongJson.reads.reads(JsNumber(0)) == JsSuccess(0L))
    }
    "fail on malformed input" in {
      assert(UnsignedLongJson.reads.reads(JsString("not-a-number")).isError)
      assert(UnsignedLongJson.reads.reads(Json.obj()).isError)
    }
  }

  "UnsignedLongJson-patched action formats" should {
    "round-trip a segment id above 2^53 as a JSON string, leaving other Long fields as JsNumber" in {
      val action = CreateSegmentVolumeAction(
        id = (1L << 60) + 7L,
        anchorPosition = None,
        name = None,
        color = None,
        groupId = None,
        creationTime = Some(1234567890L),
        actionTracingId = "someTracingId"
      )
      val json = Json.toJson(action)
      assert((json \ "id").as[String] == java.lang.Long.toUnsignedString((1L << 60) + 7L))
      // creationTime is a timestamp, not an id, and must keep the default JsNumber encoding.
      assert((json \ "creationTime").as[Long] == 1234567890L)

      val parsedBack = json.validate[CreateSegmentVolumeAction]
      assert(parsedBack == JsSuccess(action))
    }

    "round-trip an id above Long.MaxValue's bit pattern (true uint64 range)" in {
      val action = UpdateActiveSegmentIdVolumeAction(
        activeSegmentId = -1L, // 2^64 - 1
        actionTracingId = "someTracingId"
      )
      val json = Json.toJson(action)
      assert((json \ "activeSegmentId").as[String] == "18446744073709551615")
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
            agglomerateId1 = 111L,
            agglomerateId2 = 222L,
            segmentId1 = 333L,
            segmentId2 = 444L,
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

}
