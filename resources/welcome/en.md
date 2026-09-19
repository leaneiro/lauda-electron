# Welcome to <span class="wordmark">Lauda</span> 👋

<span class="wordmark">Lauda</span> is a Markdown editor with two panes: you write on the left and see the formatted result on the right, updated as you type.

This is an untitled document, so feel free to experiment. To keep it, save it with ⌘S; otherwise just close it. You can reopen this guide anytime from **Help → Welcome Guide**.

## Writing

Text can be **bold** (⌘B), *italic* (⌘I), or `code`. Select some text and press ⌘K to turn it into a [link](https://daringfireball.net/projects/markdown/), or paste a URL over the selection.

Type `->` or `<-` outside code and they become → and ←.

Type `(`, `[`, `*` or `"` and the closing one comes along, with the caret in between. With text selected, the pair wraps it.

> Quotes look like this.

## Lists

- Press Return at the end of an item to start the next one
- Tab and Shift-Tab indent and outdent items
  - Like this one

1. Numbered lists continue too
2. And pick up the next number

### Tasks

- [x] Open <span class="wordmark">Lauda</span>
- [ ] Write something great

## Code

```swift
struct Greeting {
    let name: String

    func sayHello() -> String {
        "Hello, \(name)!"
    }
}
```

## Tables

| Feature            | Shortcut |
|:-------------------|:--------:|
| Editor only        | ⌘1       |
| Editor and preview | ⌘2       |
| Preview only       | ⌘3       |
| Find               | ⌘F       |
| Export as PDF      | ⇧⌘E      |

## Images

Drag an image into the editor, or paste a screenshot, and it's copied next to the document with the Markdown already written for you. Save the document first, so the image has a folder to go to.

## Finding your way

- The **Outline** button in the toolbar lists the headings and jumps to them.
- Both panes scroll together.
- Fonts, sizes, appearance, and line breaks are in **Settings** (⌘,).

Happy writing! ✍️
