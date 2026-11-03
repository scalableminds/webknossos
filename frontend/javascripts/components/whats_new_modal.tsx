import { Alert, Card, Flex, Modal, Spin, Tag, Typography } from "antd";
import Markdown, { LinkRenderer } from "libs/markdown_adapter";
import {
  isReleaseNoteUnread,
  loadReleaseNotes,
  type ReleaseNote,
  type ReleaseNotesReadState,
} from "libs/release_notes";
import type React from "react";
import { useEffect, useState } from "react";
import { ModalWidth } from "theme";
import { UserThemeConfigProvider } from "theme_provider";

const YOUTUBE_URL_REGEX = /^https:\/\/(?:(?:www\.)?youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/;

// A bare YouTube link (e.g. `<https://www.youtube.com/watch?v=ID>` or `<https://youtu.be/ID>`) is
// rendered as an embedded video. Links with a custom text stay regular links.
function ReleaseNoteLink(props: { children: React.ReactNode; href: string }) {
  const youtubeMatch = props.href.match(YOUTUBE_URL_REGEX);
  if (youtubeMatch != null && props.children === props.href) {
    return (
      <iframe
        className="release-note-video"
        src={`https://www.youtube-nocookie.com/embed/${youtubeMatch[1]}?modestbranding=1`}
        title="YouTube video"
        loading="lazy"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        referrerPolicy="strict-origin-when-cross-origin"
        allowFullScreen
      />
    );
  }
  return <LinkRenderer {...props} />;
}

function ReleaseNoteImage({ src, alt }: { src?: string; alt?: string }) {
  // Release notes contain large GIFs. Only load them once they are scrolled into view.
  return <img src={src} alt={alt ?? ""} loading="lazy" />;
}

const RELEASE_NOTE_MARKDOWN_COMPONENTS = { a: ReleaseNoteLink, img: ReleaseNoteImage };

function ReleaseNoteEntry({ note, isUnread }: { note: ReleaseNote; isUnread: boolean }) {
  return (
    <Card className="release-note">
      <Flex align="baseline" gap="small" wrap>
        <Typography.Title level={2} style={{ marginTop: 0, marginBottom: 0 }}>
          {note.title}
        </Typography.Title>
        {isUnread ? <Tag color="blue">New</Tag> : null}
      </Flex>
      <Typography.Paragraph type="secondary">
        {new Date(note.date).toLocaleDateString(undefined, { dateStyle: "long", timeZone: "UTC" })}
      </Typography.Paragraph>
      <Markdown components={RELEASE_NOTE_MARKDOWN_COMPONENTS}>{note.body}</Markdown>
    </Card>
  );
}

function ReleaseNoteList({ readState }: { readState: ReleaseNotesReadState }) {
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
  return (
    <Flex vertical gap="middle">
      {releaseNotes.map((note) => (
        <ReleaseNoteEntry
          key={note.id}
          note={note}
          isUnread={isReleaseNoteUnread(note, readState)}
        />
      ))}
    </Flex>
  );
}

export function WhatsNewModal({
  isOpen,
  onClose,
  readState,
}: {
  isOpen: boolean;
  onClose: () => void;
  // Determines which release notes are marked as new.
  readState: ReleaseNotesReadState;
}) {
  return (
    // The modal is opened from the dark navbar and would otherwise inherit its theme.
    <UserThemeConfigProvider>
      <Modal
        open={isOpen}
        onCancel={onClose}
        title="What's new in WEBKNOSSOS"
        footer={null}
        width={ModalWidth.Large}
        destroyOnHidden
      >
        <ReleaseNoteList readState={readState} />
      </Modal>
    </UserThemeConfigProvider>
  );
}
