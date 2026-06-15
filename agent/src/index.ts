import quizAgent from "./quiz/index.js";
import taskAAgent from "./taskA/index.js";
import teacherNotesAgent from "./teacherNotes/index.js";
import todayIntroAgent from "./todayIntro/index.js";
import ltiAgent from "./lti/index.js";

type Env = {
  AGENT_API_KEY?: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  LTI_TOOL_CLIENT_ID?: string;
  LTI_TOOL_PRIVATE_JWK?: string;
  LTI_TOOL_PUBLIC_JWK?: string;
  LTI_TOOL_KID?: string;
  LTI_STATE_SECRET?: string;
  LTI_ALLOWED_ISSUERS?: string;
  LTI_TOOL_BASE_URL?: string;
  LTI_TOOL_TITLE?: string;
  LTI_TOOL_DESCRIPTION?: string;
};

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (
      url.pathname === "/lti" ||
      url.pathname === "/lti/health" ||
      url.pathname === "/lti/config" ||
      url.pathname === "/lti/login" ||
      url.pathname === "/lti/launch" ||
      url.pathname === "/lti/deep-link" ||
      url.pathname === "/lti/icon.svg" ||
      url.pathname === "/.well-known/jwks.json"
    ) {
      return ltiAgent.fetch(request, env);
    }
    if (url.pathname === "/today-intro") {
      return todayIntroAgent.fetch(request, env);
    }
    if (url.pathname === "/generate-quiz") {
      return quizAgent.fetch(request, env);
    }
    if (url.pathname === "/task-a-content") {
      return taskAAgent.fetch(request, env);
    }
    if (url.pathname === "/teacher-notes") {
      return teacherNotesAgent.fetch(request, env);
    }
    if (url.pathname === "/generate") {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            error: "Route moved. Use /generate-quiz."
          }),
          {
            status: 410,
            headers: { "Content-Type": "application/json; charset=utf-8" }
          }
        )
      );
    }
    return Promise.resolve(
        new Response(
          JSON.stringify({
          error:
            "Not found. Available routes: /generate-quiz, /today-intro, /task-a-content, /teacher-notes, /lti/config"
        }),
        {
          status: 404,
          headers: { "Content-Type": "application/json; charset=utf-8" }
        }
      )
    );
  }
};
