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

const MIN_GAP_BEFORE_INFOS = 20;

function Statusbar() {
  // When space runs out (e.g. on 13" laptops), only as many hints as fit are shown; the
  // rest move into the "More" popover so that everything stays reachable.
  const items = useShortcutItems();

  // The following refs will be used to measure the available space for the shortcut hints.
  const containerRef = useRef<HTMLSpanElement>(null); // the full statusbar
  const leftRef = useRef<HTMLSpanElement>(null); // left sidebar toggle
  const infosRef = useRef<HTMLSpanElement>(null); // dataset/annotation infos
  const rightRef = useRef<HTMLSpanElement>(null); // right sidebar toggle
  // The following refs will be used to measure the needed space for the shortcut hints.
  // The corresponding dom elements will be hidden to the user.
  const fullShortcutRowRef = useRef<HTMLSpanElement>(null); // the actual shortcut hints
  const showMoreShortcutsRef = useRef<HTMLSpanElement>(null); // the "more shortcuts" button
  const showAllShortcutsRef = useRef<HTMLSpanElement>(null); // the "show shortcuts" button

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
      {/* Invisible to the user; only used for measurement. */}
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
