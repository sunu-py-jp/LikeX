import type { ChatParticipant } from "../model";
export function ChatAvatar({ person, small = false }: { person?: ChatParticipant; small?: boolean }) {
  const name = person?.name ?? "参加者";
  const tone = [...(person?.id ?? name)].reduce((sum, letter) => sum + letter.codePointAt(0)!, 0) % 6;
  return <span className={`lxh-avatar lxh-avatar-${tone}${small ? " is-small" : ""}`} title={name}>
    {/* Host-controlled standard images keep the library independent of Next.js. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    {person?.avatarUrl ? <img src={person.avatarUrl} alt="" /> : <span>{name.slice(0, 1)}</span>}
    {person?.status === "online" && <i aria-label="オンライン" />}
  </span>;
}
