# Task A Canonical Markdown Example

This document is a proposed canonical authoring example for `Task A` notes.

It is based on:

- `apps/cli/session-assets/Session 05 - Soldering/TaskA/notes.md`

This is intentionally Markdown-first:

- standard Markdown for headings, lists, images, and horizontal rules
- callout directives for styled blocks such as `note`, `warning`, and `success`
- plain standalone YouTube URLs as the proposed embed convention
- frontmatter for metadata instead of hidden processor tags

It is a reference example only. The current CLI does not yet consume this exact format end to end.

## Proposed Authoring Format

```md
---
pageTitle: Soldering the Switch & Power Connector
media:
  youtube:
    width: 560
---

Now it is onto soldering. You will first solder the slightly easier components to get into the swing of things.

Below are instructions to solder the switch and the power/DC connector.

You will need tools:

- Soldering iron
- Solder
- Brass sponge
- Flux pen
- Ruler
- Wire strippers/cutters

You will need components:

- 1x switch
- 1x DC connector
- 2x 60mm red wire for switch
- 1x red wire and 1x black wire for DC connector (140mm)
- Heat-shrink, 4 pieces

---

The finished items should look like this:

![Finished switch and power connector](images/task_a_01.jpg)

But we are starting from this:

![Starting components for switch and DC connector](images/task_a_02.jpg)

---

### Soldering Tips

- Strip the wire to a length of around 5mm.
- Twist the exposed wire ends.
- Always tin your soldering iron and keep it clean.
- Tin the wires and components before soldering them together.
- Keep your soldering iron at around 340°C.
- Use safety glasses.
- Make sure nobody is near you when you are soldering.
- Ask your teacher if your setup is all good before soldering.
- You should only need to hold the soldering iron on the part for 2-3 seconds.
- The instruction above does not always hold. That is usually a heat transfer issue.
- After soldering a connection, give it a small tug to check it is solid.

:::note
Take your time to get things right.
:::

### Read These Instructions

- For the DC connector, your black wire should be soldered to the long connector and the red wire to the short connector.
- For the switch, you must solder to the middle connector and one of the other ends.
- Add your heat-shrink over the soldered ends after soldering.

You could probably start right now just from looking at the pictures and instructions above.

If you would like to watch the videos below, they will show you how we did it.

---

### Switch and Power 01 - Preparation 1

https://youtu.be/wKPaIpJV69A

### Switch and Power 02 - Preparation 2

https://youtu.be/DoXByser9n8

### Switch and Power 03 - Soldering

https://youtu.be/dGlMZp9xbIQ

:::success
Congratulations. You have finished soldering the first part. In the next task, you will be soldering the main circuit board. Hopefully you are prepped and ready to go.
:::
```

## Proposed Conventions

### Metadata

Use frontmatter for page-level metadata:

- `pageTitle`: Canvas page title
- `media.youtube.width`: preferred YouTube embed width or layout hint

### Callouts

Use directive blocks instead of proprietary tags:

```md
:::note
Important reminder.
:::

:::warning
Safety issue or risk.
:::

:::success
Completion or checkpoint message.
:::

:::question
Prompt students to think or discuss.
:::
```

### Images

Use standard Markdown image syntax:

```md
![Alt text](images/example.jpg)
```

### Video Embeds

Use a heading followed by a standalone YouTube URL:

```md
### Example Video

https://youtu.be/VIDEO_ID
```

Proposed renderer behavior:

- if a YouTube or Vimeo URL appears on its own line, convert it to an embed
- use surrounding heading text as the media label where useful

### Horizontal Rules

Use standard Markdown:

```md
---
```

## Legacy To Proposed Mapping

- `[HR]` -> `---`
- `[IMAGE]task_a_01.jpg[/IMAGE]` -> `![Alt text](images/task_a_01.jpg)`
- `[NOTE]...[/NOTE]` -> `:::note ... :::`
- `[INFO]...[/INFO]` -> `:::info ... :::`
- `[WARNING]...[/WARNING]` -> `:::warning ... :::`
- `[SUCCESS]...[/SUCCESS]` -> `:::success ... :::`
- `[QUESTION]...[/QUESTION]` -> `:::question ... :::`
- `[YOUTUBE_LINK]https://youtu.be/...[/YOUTUBE_LINK]` -> standalone YouTube URL in Markdown
- `[AGENT]...[/AGENT]` -> frontmatter or separate structured metadata, not body content
