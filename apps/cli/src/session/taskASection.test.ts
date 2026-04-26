import test from "node:test";
import assert from "node:assert/strict";
import { buildTaskASection } from "./taskASection.js";

test("buildTaskASection renders callouts with inline styles", async () => {
  const client = {
    async listModules() {
      return [{ id: 42, name: "Session 01 - Example Topic" }];
    },
    async listModuleItems() {
      return [
        { type: "SubHeader", title: "Session 01: Task A", position: 3 }
      ];
    }
  };

  const built = await buildTaskASection(client as never, 99, "Session 01 - Example Topic", {
    pageTitle: "Example Page",
    bodyMarkdown: ":::note\nRemember to test safely.\n:::",
    calloutStyles: {
      note: "box-shadow: inset 0 0 0 1px #123456"
    }
  });

  assert.match(built.sectionHtml, /class="ng-task-callout ng-task-callout--note"/);
  assert.match(built.sectionHtml, /style="[^"]*border-left:4px solid #016CE3/);
  assert.match(built.sectionHtml, /style="[^"]*background:#fffbea/);
  assert.match(built.sectionHtml, /style="[^"]*box-shadow: inset 0 0 0 1px #123456/);
});
