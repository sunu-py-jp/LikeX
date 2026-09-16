/** URL options keep the demo canvas free of controls belonging to the host app. */
export function getDemoComponentTheme(defaultMode: "light" | "dark" | "system") {
  const query = new URLSearchParams(window.location.search);
  const mode = query.get("colorMode");
  return {
    colorMode: mode === "light" || mode === "dark" || mode === "system" ? mode : defaultMode,
    primaryColor: query.get("primaryColor") ?? undefined,
  };
}
