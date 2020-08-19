// @flow

import useDocumentTitle from "@rehooks/document-title";

function TabTitle({ title }: { title: string }) {
  useDocumentTitle(title);
  return null;
}

export default TabTitle;
