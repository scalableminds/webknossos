package backend

import com.scalableminds.webknossos.datastore.SkeletonTracing
import com.scalableminds.webknossos.datastore.idToBool.{Id32WithBool, Id64WithBool}
import com.scalableminds.webknossos.tracingstore.tracings.AnnotationUserStateUtils
import com.scalableminds.webknossos.tracingstore.tracings.volume.VolumeTracingDefaults
import org.scalatestplus.play.PlaySpec

class AnnotationUserStateTestSuite extends PlaySpec with AnnotationUserStateUtils {

  private lazy val dummySkeletonWithUserState = Dummies.skeletonTracing.copy(
    userStates = Seq(
      SkeletonTracing.SkeletonUserStateProto(
        userId = "userA",
        treeVisibilities = Seq(Id32WithBool(1, value = false)),
        treeGroupExpandedStates = Seq(Id32WithBool(1, value = true)),
        activeNodeId = Some(5)
      ),
      SkeletonTracing.SkeletonUserStateProto(
        userId = "userB",
        treeVisibilities = Seq(Id32WithBool(1, value = true), Id32WithBool(2, value = true)),
        treeGroupExpandedStates = Seq.empty,
        activeNodeId = Some(2)
      )
    )
  )

  "Skeleton user state" should {
    "be rendered into new skeleton user state correctly for userA (sparse user state present for them)" in {
      val renderedUserState =
        renderSkeletonUserStateIntoUserState(dummySkeletonWithUserState, "userA", "userB")
      assert(renderedUserState.treeVisibilities == Seq(Id32WithBool(1, false), Id32WithBool(2, true)))
      assert(renderedUserState.activeNodeId == Some(5))
      assert(renderedUserState.treeGroupExpandedStates == Seq(Id32WithBool(1, true)))
    }

    "be rendered into new skeleton user state correctly for userB (owner)" in {
      val renderedUserState =
        renderSkeletonUserStateIntoUserState(dummySkeletonWithUserState, "userB", "userB")
      assert(renderedUserState.treeVisibilities == Seq(Id32WithBool(1, true), Id32WithBool(2, true)))
      assert(renderedUserState.treeGroupExpandedStates == Seq.empty)
    }

    "be rendered into new skeleton user state correctly for userC (no user state present for them)" in {
      val renderedUserState =
        renderSkeletonUserStateIntoUserState(dummySkeletonWithUserState, "userC", "userB")
      assert(renderedUserState.treeVisibilities == Seq(Id32WithBool(1, true), Id32WithBool(2, true)))
      assert(renderedUserState.activeNodeId == Some(2))
      assert(renderedUserState.treeGroupExpandedStates == Seq.empty)
    }

  }

  "volume user states merging" should {
    "respect id mapping" in {
      val tracingAUserStates = Seq(
        VolumeTracingDefaults
          .emptyUserState("userA")
          .copy(
            segmentVisibilities = Seq(Id64WithBool(1L, true)),
            segmentGroupExpandedStates = Seq(Id32WithBool(1, true))
          ))
      val tracingBUserStates = Seq(
        VolumeTracingDefaults
          .emptyUserState("userA")
          .copy(
            segmentVisibilities = Seq(Id64WithBool(1L, false)),
            segmentGroupExpandedStates = Seq(Id32WithBool(1, false))
          ))

      val segmentIdMapB = Map((1L, 2L))
      val mergedUserStates = mergeVolumeUserStates(tracingAUserStates,
                                                   tracingBUserStates,
                                                   groupMappingA = (groupId: Int) => groupId + 5,
                                                   segmentIdMapB,
                                                   Map.empty,
                                                   Map.empty)
      assert(
        mergedUserStates == Seq(
          VolumeTracingDefaults
            .emptyUserState("userA")
            .copy(segmentVisibilities = Seq(Id64WithBool(1, true), Id64WithBool(2L, false)),
                  segmentGroupExpandedStates = Seq(Id32WithBool(6, true), Id32WithBool(1, false)))
        ))
    }
  }
}
