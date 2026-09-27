type TranscriptScrollState = {
  conversationId: string;
  userMessageIds: Set<string>;
  following: boolean;
  scrollTop: number;
};

// React reconnects the effect when messages change. Keep the reading position with
// its DOM element, while each effect owns and releases its listeners/observer.
const states = new WeakMap<HTMLElement, TranscriptScrollState>();
const bottomTolerance = 2;

export function observeAIChatTranscript(element: HTMLElement, conversationId: string, userMessageIds: readonly string[]): () => void {
  let state = states.get(element);
  if (!state || state.conversationId !== conversationId) {
    state = { conversationId, userMessageIds: new Set(userMessageIds), following: true, scrollTop: element.scrollTop };
    states.set(element, state);
  } else {
    const previousUserMessageIds = state.userMessageIds;
    if (userMessageIds.some(id => !previousUserMessageIds.has(id))) state.following = true;
    state.userMessageIds = new Set(userMessageIds);
  }
  const position = state;
  let active = true;
  const follow = () => {
    if (!active || !position.following) return;
    element.scrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
    position.scrollTop = element.scrollTop;
  };
  const onScroll = () => {
    const top = element.scrollTop;
    if (element.scrollHeight - element.clientHeight - top <= bottomTolerance) position.following = true;
    else if (top < position.scrollTop) position.following = false;
    // A taller message can change scrollHeight without user input. Do not treat
    // that alone as leaving the bottom before ResizeObserver can follow it.
    position.scrollTop = top;
  };
  element.addEventListener("scroll", onScroll, { passive: true });
  const Resize = element.ownerDocument.defaultView?.ResizeObserver;
  const observer = Resize ? new Resize(follow) : null;
  observer?.observe(element);
  // Rich content (images, expanded tool details) can resize without new messages.
  for (const child of element.children) observer?.observe(child);
  follow();
  return () => {
    active = false;
    element.removeEventListener("scroll", onScroll);
    observer?.disconnect();
  };
}
