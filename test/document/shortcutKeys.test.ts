import { describe, expect, it } from "vitest";
import { withCtrlShortcuts } from "../../src/shared/document";

describe("the guide's shortcuts off the Mac", () => {
  it("writes each one the way Windows and Linux spell it", () => {
    expect(withCtrlShortcuts("salve com ⌘S")).toBe("salve com Ctrl+S");
    expect(withCtrlShortcuts("~~tachado~~ (⇧⌘X)")).toBe("~~tachado~~ (Ctrl+Shift+X)");
    expect(withCtrlShortcuts("**Ajustes** (⌘,)")).toBe("**Ajustes** (Ctrl+,)");
    expect(withCtrlShortcuts("Exportar como PDF: ⇧⌘E")).toBe("Exportar como PDF: Ctrl+Shift+E");
  });

  it("follows the menus where they differ off the Mac", () => {
    expect(withCtrlShortcuts("Localizar e Substituir (⌥⌘F)")).toBe("Localizar e Substituir (Ctrl+H)");
    // The one with no shortcut off the Mac loses its parentheses too.
    expect(withCtrlShortcuts("Exportar como HTML (⌥⇧⌘E) fica no menu")).toBe("Exportar como HTML fica no menu");
    // In a table the cell is simply left empty.
    expect(withCtrlShortcuts("| Exportar como HTML | ⌥⇧⌘E |")).toBe("| Exportar como HTML |   |");
  });

  it("leaves text without shortcuts as it is", () => {
    const text = "# Guia\n\nNada de atalhos aqui.\n";
    expect(withCtrlShortcuts(text)).toBe(text);
  });

  it("lines the tables up again, the names being longer", () => {
    const table = [
      "| Modo                  | Atalho |",
      "| --------------------- | ------ |",
      "| Somente editor        | ⌘1     |",
      "| Editor e visualização | ⌘2     |",
      "",
    ].join("\n");
    expect(withCtrlShortcuts(table)).toBe(
      [
        "| Modo                  | Atalho |",
        "| --------------------- | ------ |",
        "| Somente editor        | Ctrl+1 |",
        "| Editor e visualização | Ctrl+2 |",
        "",
      ].join("\n"),
    );
  });
});
