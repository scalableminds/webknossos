import React, { useRef } from "react";
import BorderToggleButton from "../components/border_toggle_button";
import {
  ALL_HIDDEN_LABEL,
  MORE_LABEL,
  MoreButtonLabel,
  MoreShortcutsButton,
  useShortcutItems,
} from "./control_infos";
import { useOverflowMeasurement } from "./use_overflow_measurement";
import Infos from "./view_infos";

// Keeps a visible gap between the (right-aligned) shortcut hints and Infos, matching
// the existing spacing convention of .info-element/.shortcut-info-element.
const MIN_GAP_BEFORE_INFOS = 20;

function Statusbar() {
  // The statusbar can run out of horizontal space (e.g. on 13" laptops). Since the
  // shortcut hints are the least essential elements (as opposed to e.g. the "Active
  // Segment" input, which is not just informational), as many of them as fit are shown
  // individually, with the rest tucked behind a "More" popover, so that all other
  // elements remain reachable.
  const items = useShortcutItems();

  const containerRef = useRef<HTMLSpanElement>(null);
  const leftRef = useRef<HTMLSpanElement>(null);
  const infosRef = useRef<HTMLSpanElement>(null);
  const rightRef = useRef<HTMLSpanElement>(null);
  const measureRowRef = useRef<HTMLSpanElement>(null);
  const measureMoreRef = useRef<HTMLSpanElement>(null);
  const measureAllHiddenRef = useRef<HTMLSpanElement>(null);

  const { visibleCount, setItemRef } = useOverflowMeasurement({
    containerRef,
    fixedRefs: [leftRef, infosRef, rightRef],
    measureRowRef,
    triggerMeasureRefs: [measureMoreRef, measureAllHiddenRef],
    itemKeys: items.map((item) => item.key),
    minGap: MIN_GAP_BEFORE_INFOS,
  });

  const hiddenItems = items.slice(visibleCount);

  return (
    <span className="statusbar" ref={containerRef}>
      <span ref={leftRef} style={{ display: "inline-flex" }}>
        <BorderToggleButton side="left" inFooter />
      </span>
      {items.slice(0, visibleCount).map((item) => (
        <React.Fragment key={item.key}>{item.node}</React.Fragment>
      ))}
      {hiddenItems.length > 0 ? (
        <MoreShortcutsButton hiddenItems={hiddenItems} allHidden={visibleCount === 0} />
      ) : null}
      <span ref={infosRef} style={{ display: "inline-flex", marginLeft: "auto" }}>
        <Infos />
      </span>
      <span ref={rightRef} style={{ display: "inline-flex" }}>
        <BorderToggleButton side="right" inFooter />
      </span>
      <span ref={measureRowRef} className="statusbar-measurer" aria-hidden="true">
        {items.map((item) => (
          <span key={item.key} ref={setItemRef(item.key)} style={{ display: "inline-flex" }}>
            {item.node}
          </span>
        ))}
        <span ref={measureMoreRef} style={{ display: "inline-flex" }}>
          <MoreButtonLabel label={MORE_LABEL} />
        </span>
        <span ref={measureAllHiddenRef} style={{ display: "inline-flex" }}>
          <MoreButtonLabel label={ALL_HIDDEN_LABEL} />
        </span>
      </span>
    </span>
  );
}

export default Statusbar;
