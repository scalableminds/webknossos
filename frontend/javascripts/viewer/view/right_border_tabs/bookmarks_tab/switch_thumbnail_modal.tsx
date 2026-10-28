import { Card, Empty, Flex, Modal, Spin } from "antd";
import { useEffect, useState } from "react";
import { FlightViewport, FlightViewsToName, OrthoViewsToName } from "viewer/constants";
import {
  type BookmarkThumbnails,
  type BookmarkThumbnailViewport,
  captureBookmarkThumbnailsOfViewport,
  getRenderedBookmarkThumbnailViewports,
} from "viewer/view/rendering_utils";

type ViewportThumbnails = {
  viewport: BookmarkThumbnailViewport;
  thumbnails: BookmarkThumbnails;
};

const PREVIEW_SIZE = 160;

function getViewportName(viewport: BookmarkThumbnailViewport): string {
  return viewport === FlightViewport ? FlightViewsToName[viewport] : OrthoViewsToName[viewport];
}

async function captureAllViewports(): Promise<ViewportThumbnails[]> {
  const result: ViewportThumbnails[] = [];
  for (const viewport of getRenderedBookmarkThumbnailViewports()) {
    const thumbnails = await captureBookmarkThumbnailsOfViewport(viewport);
    if (thumbnails != null) result.push({ viewport, thumbnails });
  }
  return result;
}

// Offers the currently rendered viewports as the new thumbnail of a bookmark.
// The bookmark has to be selected, so that the current view is the one of the bookmark.
export function SwitchThumbnailModal({
  bookmarkName,
  onSelect,
  onClose,
}: {
  bookmarkName: string;
  onSelect: (thumbnails: BookmarkThumbnails) => void;
  onClose: () => void;
}) {
  const [options, setOptions] = useState<ViewportThumbnails[] | null>(null);

  useEffect(() => {
    let isCancelled = false;
    captureAllViewports()
      .then((captured) => {
        if (!isCancelled) setOptions(captured);
      })
      .catch((error) => {
        console.error("Could not capture bookmark thumbnails.", error);
        if (!isCancelled) setOptions([]);
      });
    return () => {
      isCancelled = true;
    };
  }, []);

  return (
    <Modal
      open
      title={`Select thumbnail for bookmark “${bookmarkName}”`}
      onCancel={onClose}
      footer={null}
      // As wide as the cards, which wrap on narrow screens.
      width="fit-content"
      style={{ maxWidth: "calc(100vw - 32px)" }}
    >
      {options == null ? (
        <Flex justify="center">
          <Spin />
        </Flex>
      ) : options.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No viewport is rendered." />
      ) : (
        <Flex gap="small" wrap>
          {options.map(({ viewport, thumbnails }) => (
            <Card
              key={viewport}
              hoverable
              size="small"
              title={getViewportName(viewport)}
              onClick={() => onSelect(thumbnails)}
              styles={{ body: { padding: 8 } }}
            >
              <Flex
                align="center"
                justify="center"
                style={{ width: PREVIEW_SIZE, height: PREVIEW_SIZE }}
              >
                <img
                  src={`data:image/webp;base64,${thumbnails.largeDataBase64}`}
                  alt={`${getViewportName(viewport)} viewport`}
                  style={{
                    maxWidth: PREVIEW_SIZE,
                    maxHeight: PREVIEW_SIZE,
                    borderRadius: "var(--ant-border-radius-sm)",
                  }}
                />
              </Flex>
            </Card>
          ))}
        </Flex>
      )}
    </Modal>
  );
}
