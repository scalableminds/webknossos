import { Alert, Button, Divider, Flex, Modal, Spin, Tag, Typography } from "antd";
import Markdown, { LinkRenderer } from "libs/markdown_adapter";
import { loadReleaseNotes, type ReleaseNote } from "libs/release_notes";
import type React from "react";
import { Fragment, useEffect, useState } from "react";
import { ModalWidth } from "theme";

const YOUTUBE_URL_REGEX = /^https:\/\/(?:www\.)?youtube\.com\/watch\?v=([\w-]+)/;

// A bare YouTube link (e.g. `<https://www.youtube.com/watch?v=ID>`) is rendered as an embedded
// video. Links with a custom text stay regular links.
function ReleaseNoteLink(props: { children: React.ReactNode; href: string }) {
  const youtubeMatch = props.href.match(YOUTUBE_URL_REGEX);
  if (youtubeMatch != null && props.children === props.href) {
    return (
      <iframe
        className="release-note-video"
        src={`https://www.youtube-nocookie.com/embed/${youtubeMatch[1]}?modestbranding=1`}
        title="YouTube video"
        allowFullScreen
      />
    );
  }
  return <LinkRenderer {...props} />;
}

const RELEASE_NOTE_MARKDOWN_COMPONENTS = { a: ReleaseNoteLink };

function ReleaseNoteEntry({ note, isUnread }: { note: ReleaseNote; isUnread: boolean }) {
  return (
    <article className="release-note">
      <Flex align="baseline" gap="small" wrap>
        <Typography.Title level={2} style={{ marginTop: 0, marginBottom: 0 }}>
          {note.title}
        </Typography.Title>
        {isUnread ? <Tag color="blue">New</Tag> : null}
      </Flex>
      <Typography.Paragraph type="secondary">
        {new Date(note.date).toLocaleDateString(undefined, { dateStyle: "long", timeZone: "UTC" })}
      </Typography.Paragraph>
      {note.featuredImage != null ? <img src={note.featuredImage} alt="" /> : null}
      <Markdown components={RELEASE_NOTE_MARKDOWN_COMPONENTS}>{note.body}</Markdown>
      {note.featuredLink != null ? (
        <Button type="primary" href={note.featuredLink} target="_blank" rel="noreferrer noopener">
          {note.featuredLinkText || "Read more"}
        </Button>
      ) : null}
    </article>
  );
}

function ReleaseNoteList({ unreadSinceTimestamp }: { unreadSinceTimestamp: number }) {
  const [releaseNotes, setReleaseNotes] = useState<ReleaseNote[] | null>(null);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    let isCurrent = true;
    loadReleaseNotes().then(
      (notes) => isCurrent && setReleaseNotes(notes),
      (error) => {
        console.error(error);
        if (isCurrent) setHasError(true);
      },
    );
    return () => {
      isCurrent = false;
    };
  }, []);

  if (hasError) {
    return <Alert type="error" title="The release notes could not be loaded." />;
  }
  if (releaseNotes == null) {
    return (
      <Flex justify="center">
        <Spin />
      </Flex>
    );
  }
  return releaseNotes.map((note, index) => (
    <Fragment key={note.id}>
      {index > 0 ? <Divider /> : null}
      <ReleaseNoteEntry note={note} isUnread={note.date > unreadSinceTimestamp} />
    </Fragment>
  ));
}

export function WhatsNewModal({
  isOpen,
  onClose,
  unreadSinceTimestamp,
}: {
  isOpen: boolean;
  onClose: () => void;
  // Release notes published after this timestamp are marked as new.
  unreadSinceTimestamp: number;
}) {
  return (
    <Modal
      open={isOpen}
      onCancel={onClose}
      title="What's new in WEBKNOSSOS"
      footer={null}
      width={ModalWidth.Large}
      destroyOnHidden
    >
      <ReleaseNoteList unreadSinceTimestamp={unreadSinceTimestamp} />
    </Modal>
  );
}
