import { extendTailwindMerge, twMerge } from "tailwind-merge";

/** All internal utility literals use the same prefix as the distributed CSS. */
export const mergeExplorerClasses = extendTailwindMerge({ prefix: "lxe" });

const withoutExplorerPrefix = (token: string) => token.startsWith("lxe:") ? token.slice(4) : token;

/** Let host utility classes replace matching defaults while keeping host CSS names intact. */
export function mergeExplorerRootClasses(base: string, hostClassName?: string): string {
  if (!hostClassName?.trim()) return mergeExplorerClasses(base);
  const hostTokens = hostClassName.trim().split(/\s+/);
  const originalHostTokens = new Map(hostTokens.map(token => [withoutExplorerPrefix(token), token]));
  const merged = twMerge(
    base.split(/\s+/).map(withoutExplorerPrefix).join(" "),
    hostTokens.map(withoutExplorerPrefix).join(" "),
  );
  return merged.split(/\s+/).map(token => originalHostTokens.get(token) ?? `lxe:${token}`).join(" ");
}
