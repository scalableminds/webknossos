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
import ViewInfos from "./view_infos";

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

  // The following refs will be used to measure the available space for the shortcut hints.
  // - containerRef: the full status bar
  // - leftRef: for the "left sidebar toggle")
  // - infosRef: for the dataset/annotation-specific infos)
  // - rightRef: for the "right sidebar toggle")
  const containerRef = useRef<HTMLSpanElement>(null);
  const leftRef = useRef<HTMLSpanElement>(null);
  const infosRef = useRef<HTMLSpanElement>(null);
  const rightRef = useRef<HTMLSpanElement>(null);
  // The following refs will be used to measure the needed space for the shortcut hints.
  // The corresponding dom elements will be hidden to the user (the actual visibility depends
  // on the available space).
  // - fullShortcutRowRef: the actual shortcut hints
  // - showMoreShortcutsRef: the "more shortcuts" button
  // - showAllShortcutsRef: the "show shortcuts" button
  const fullShortcutRowRef = useRef<HTMLSpanElement>(null);
  const showMoreShortcutsRef = useRef<HTMLSpanElement>(null);
  const showAllShortcutsRef = useRef<HTMLSpanElement>(null);

  const { visibleCount, setItemRefFactory } = useOverflowMeasurement({
    containerRef,
    fixedRefs: [leftRef, infosRef, rightRef],
    measureRowRef: fullShortcutRowRef,
    triggerMeasureRefs: [showMoreShortcutsRef, showAllShortcutsRef],
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
        <ViewInfos />
      </span>
      <span ref={rightRef} style={{ display: "inline-flex" }}>
        <BorderToggleButton side="right" inFooter />
      </span>
      {/* The following span is completely invisible to the user and only used for measurement. */}
      <span ref={fullShortcutRowRef} className="statusbar-measurer" aria-hidden="true">
        {items.map((item) => (
          <span key={item.key} ref={setItemRefFactory(item.key)} style={{ display: "inline-flex" }}>
            {item.node}
          </span>
        ))}
        <span ref={showMoreShortcutsRef} style={{ display: "inline-flex" }}>
          <MoreButtonLabel label={MORE_LABEL} />
        </span>
        <span ref={showAllShortcutsRef} style={{ display: "inline-flex" }}>
          <MoreButtonLabel label={ALL_HIDDEN_LABEL} />
        </span>
      </span>
    </span>
  );
}

export default Statusbar;
