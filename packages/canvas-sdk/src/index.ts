type FetchOptions = {
  method?: string;
  path: string;
  body?: unknown;
};

export type CanvasModuleSummary = {
  id: number;
  name: string;
};

export type CanvasModuleItem = {
  id: number;
  title: string;
  type: string;
  position: number;
  page_url?: string | null;
};

export type CanvasPage = {
  page_id: number;
  url: string;
  title: string;
  body?: string;
  published?: boolean;
};

export type CanvasQuizSummary = {
  id: number;
  title: string;
  quiz_type?: string;
  published?: boolean;
  html_url?: string;
};

export type CanvasQuiz = CanvasQuizSummary & {
  description?: string;
  assignment_group_id?: number;
  time_limit?: number;
  allowed_attempts?: number;
  shuffle_answers?: boolean;
  show_correct_answers?: boolean;
  scoring_policy?: string;
  one_question_at_a_time?: boolean;
  cant_go_back?: boolean;
  access_code?: string;
  ip_filter?: string;
  due_at?: string;
  lock_at?: string;
  unlock_at?: string;
  published_at?: string;
  lock_questions_after_answering?: boolean;
  hide_results?: string;
};

export type CanvasQuizQuestion = {
  id?: number;
  quiz_id?: number;
  position?: number;
  [key: string]: unknown;
};

export class CanvasClient {
  private baseUrl: string;
  private token: string;

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.token = token;
  }

  private async request<T>(opts: FetchOptions): Promise<T> {
    const url = `${this.baseUrl}${opts.path}`;
    const res = await fetch(url, {
      method: opts.method ?? "GET",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json"
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `Canvas API error ${res.status} ${res.statusText} for ${opts.method ?? "GET"} ${opts.path}\n${text}`
      );
    }

    return (await res.json()) as T;
  }

  async createQuiz(
    courseId: number,
    quiz: {
      title: string;
      description?: string;
      quiz_type?: string;
      published?: boolean;
      time_limit?: number;
      allowed_attempts?: number;
      assignment_group_id?: number;
      shuffle_answers?: boolean;
      show_correct_answers?: boolean;
      scoring_policy?: string;
      one_question_at_a_time?: boolean;
      cant_go_back?: boolean;
      access_code?: string;
      ip_filter?: string;
      due_at?: string;
      lock_at?: string;
      unlock_at?: string;
      lock_questions_after_answering?: boolean;
      hide_results?: string;
    }
  ): Promise<{ id: number; html_url?: string; title: string }> {
    const quizType = quiz.quiz_type ?? "assignment";
    return this.request({
      method: "POST",
      path: `/api/v1/courses/${courseId}/quizzes`,
      body: { quiz: { ...quiz, quiz_type: quizType } }
    });
  }

  async addQuizQuestion(courseId: number, quizId: number, question: unknown): Promise<{ id: number }> {
    return this.request({
      method: "POST",
      path: `/api/v1/courses/${courseId}/quizzes/${quizId}/questions`,
      body: { question }
    });
  }

  async updateQuiz(
    courseId: number,
    quizId: number,
    quiz: { published?: boolean }
  ): Promise<{ id: number; published?: boolean; question_count?: number }> {
    return this.request({
      method: "PUT",
      path: `/api/v1/courses/${courseId}/quizzes/${quizId}`,
      body: { quiz }
    });
  }

  async listQuizzes(courseId: number, searchTerm?: string): Promise<CanvasQuizSummary[]> {
    const params = new URLSearchParams({ per_page: "100" });
    if (searchTerm && searchTerm.trim().length > 0) {
      params.set("search_term", searchTerm.trim());
    }
    return this.request({
      method: "GET",
      path: `/api/v1/courses/${courseId}/quizzes?${params.toString()}`
    });
  }

  async getQuiz(courseId: number, quizId: number): Promise<CanvasQuiz> {
    return this.request({
      method: "GET",
      path: `/api/v1/courses/${courseId}/quizzes/${quizId}`
    });
  }

  async listQuizQuestions(courseId: number, quizId: number): Promise<CanvasQuizQuestion[]> {
    return this.request({
      method: "GET",
      path: `/api/v1/courses/${courseId}/quizzes/${quizId}/questions?per_page=100`
    });
  }

  async listModules(courseId: number, searchTerm?: string): Promise<CanvasModuleSummary[]> {
    const params = new URLSearchParams({ per_page: "100" });
    if (searchTerm && searchTerm.trim().length > 0) {
      params.set("search_term", searchTerm.trim());
    }
    return this.request({
      method: "GET",
      path: `/api/v1/courses/${courseId}/modules?${params.toString()}`
    });
  }

  async listModuleItems(courseId: number, moduleId: number): Promise<CanvasModuleItem[]> {
    return this.request({
      method: "GET",
      path: `/api/v1/courses/${courseId}/modules/${moduleId}/items?per_page=100`
    });
  }

  async listPages(courseId: number, searchTerm?: string): Promise<CanvasPage[]> {
    const params = new URLSearchParams({ per_page: "100" });
    if (searchTerm && searchTerm.trim().length > 0) {
      params.set("search_term", searchTerm.trim());
    }
    return this.request({
      method: "GET",
      path: `/api/v1/courses/${courseId}/pages?${params.toString()}`
    });
  }

  async getPage(courseId: number, pageUrl: string): Promise<CanvasPage> {
    return this.request({
      method: "GET",
      path: `/api/v1/courses/${courseId}/pages/${encodeURIComponent(pageUrl)}`
    });
  }

  async createPage(
    courseId: number,
    input: { title: string; body: string; published?: boolean }
  ): Promise<CanvasPage> {
    return this.request({
      method: "POST",
      path: `/api/v1/courses/${courseId}/pages`,
      body: {
        wiki_page: {
          title: input.title,
          body: input.body,
          published: input.published ?? true
        }
      }
    });
  }

  async updatePage(
    courseId: number,
    pageUrl: string,
    input: { title?: string; body?: string; published?: boolean }
  ): Promise<CanvasPage> {
    return this.request({
      method: "PUT",
      path: `/api/v1/courses/${courseId}/pages/${encodeURIComponent(pageUrl)}`,
      body: { wiki_page: input }
    });
  }

  async createModuleSubHeader(
    courseId: number,
    moduleId: number,
    title: string
  ): Promise<{ id: number; title: string }> {
    return this.request({
      method: "POST",
      path: `/api/v1/courses/${courseId}/modules/${moduleId}/items`,
      body: {
        module_item: {
          title,
          type: "SubHeader"
        }
      }
    });
  }

  async createModulePageItem(
    courseId: number,
    moduleId: number,
    input: { title?: string; pageUrl: string; position?: number }
  ): Promise<{ id: number; title: string; position: number; page_url?: string }> {
    return this.request({
      method: "POST",
      path: `/api/v1/courses/${courseId}/modules/${moduleId}/items`,
      body: {
        module_item: {
          type: "Page",
          title: input.title,
          page_url: input.pageUrl,
          position: input.position
        }
      }
    });
  }

  async updateModuleItemPosition(
    courseId: number,
    moduleId: number,
    itemId: number,
    position: number
  ): Promise<{ id: number; title: string; position: number }> {
    return this.request({
      method: "PUT",
      path: `/api/v1/courses/${courseId}/modules/${moduleId}/items/${itemId}`,
      body: { module_item: { position } }
    });
  }
}
