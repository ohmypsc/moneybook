export type AppShortcut =
  | { navigation: "input"; mode: "expense" | "income" | "transfer" }
  | { navigation: "calendar" };

export function parseAppShortcut(search: string): AppShortcut | null {
  const params = new URLSearchParams(search);
  const action = params.get("shortcut");

  if (action === "expense" || action === "income" || action === "transfer") {
    return {
      navigation: "input",
      mode: action
    };
  }

  if (action === "history") {
    return {
      navigation: "calendar"
    };
  }

  return null;
}
