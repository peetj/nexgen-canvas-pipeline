import quizAgent from "./quiz/index.js";
import taskAAgent from "./taskA/index.js";
import todayIntroAgent from "./todayIntro/index.js";

type Env = {
  AGENT_API_KEY?: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
};

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/today-intro") {
      return todayIntroAgent.fetch(request, env);
    }
    if (url.pathname === "/generate-quiz") {
      return quizAgent.fetch(request, env);
    }
    if (url.pathname === "/task-a-content") {
      return taskAAgent.fetch(request, env);
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
          error: "Not found. Available routes: /generate-quiz, /today-intro, /task-a-content"
        }),
        {
          status: 404,
          headers: { "Content-Type": "application/json; charset=utf-8" }
        }
      )
    );
  }
};
