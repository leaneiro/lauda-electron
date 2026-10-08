/// The glass answers the pointer with a light that follows it, on every
/// piece of glass under `root`.
export function lightGlass(root: HTMLElement): void {
  root.addEventListener("pointermove", (event) => {
    const glass = (event.target as HTMLElement).closest<HTMLElement>(".glass");
    if (!glass) return;
    const rect = glass.getBoundingClientRect();
    glass.style.setProperty("--pointer-x", `${event.clientX - rect.left}px`);
    glass.style.setProperty("--pointer-y", `${event.clientY - rect.top}px`);
  });
}

/// A new element of the page, with its class and its text.
export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
