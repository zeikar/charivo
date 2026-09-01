import { NoticeBar } from "./NoticeBar";

type RealtimeErrorNoticeProps = {
  message: string | null;
  onDismiss: () => void;
};

/**
 * Says why a realtime session failed, above the chat input.
 *
 * The other client errors render inside `ChatSettings`, but a realtime failure
 * cannot: that panel is Headless UI `MenuItems`, which unmounts when the menu
 * closes, and pressing Talk closes it — so the failure would arrive with
 * nothing on screen to carry it. This bar sits where the user already is, and
 * shares `NoticeBar` with the `SessionCapNotice` it renders beside.
 */
export function RealtimeErrorNotice({
  message,
  onDismiss,
}: RealtimeErrorNoticeProps) {
  if (!message) {
    return null;
  }

  return (
    <NoticeBar
      tone="error"
      role="alert"
      icon="⚠️"
      message={message}
      onDismiss={onDismiss}
    />
  );
}
