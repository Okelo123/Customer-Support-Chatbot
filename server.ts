import express from "express";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  GoogleGenAI,
  Type,
  type Content,
  type FunctionDeclaration,
  type Part,
} from "@google/genai";

interface BugReport {
  ticketId: string;
  description: string;
  stepsToReproduce: string;
  environment: string;
  status: "OPEN" | "RESOLVED";
  createdAt: string;
}

interface ToolCallRecord {
  name: string;
  args: Record<string, unknown>;
  result: Record<string, unknown>;
}

const PORT = Number(process.env.PORT) || 3000;
const MODEL_ID = "gemini-4-hydrogen";
const FAQ_PLACEHOLDER = "{{FAQ}}";

function loadFaqContent(): string {
  const faqPath = path.join(process.cwd(), "online_shop_faq.md");
  return fs.readFileSync(faqPath, "utf-8");
}

function loadSystemPrompt(): string {
  const promptPath = path.join(process.cwd(), "system_prompt.txt");
  const template = fs.readFileSync(promptPath, "utf-8");
  if (template.includes(FAQ_PLACEHOLDER)) {
    return template.replace(FAQ_PLACEHOLDER, loadFaqContent());
  }
  return template;
}

const createBugReportDeclaration: FunctionDeclaration = {
  name: "create_bug_report",
  description:
    "File a bug ticket in the engineering team's tracker. Call this only after the customer has provided a bug description, the steps to reproduce it, and their environment. Returns the new ticket's ID.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      description: {
        type: Type.STRING,
        description: "What is broken, in the customer's words.",
      },
      stepsToReproduce: {
        type: Type.STRING,
        description: "Steps to follow to reproduce the issue.",
      },
      environment: {
        type: Type.STRING,
        description: "Customer's environment: browser, OS, device.",
      },
    },
    required: ["description", "stepsToReproduce", "environment"],
  },
};

// In-memory stores (replaces DynamoDB table and AgentCore runtime session state)
const bugReports: BugReport[] = [];
const sessions = new Map<string, Content[]>();

let cachedAiClient: GoogleGenAI | null = null;
function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not configured. Please check Settings > Secrets."
    );
  }
  if (!cachedAiClient) {
    cachedAiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return cachedAiClient;
}

function executeCreateBugReport(
  args: Record<string, unknown>
): Record<string, unknown> {
  const description = String(args.description ?? "").trim();
  const steps = String(args.stepsToReproduce ?? "").trim();
  const environment = String(args.environment ?? "").trim();

  const missing: string[] = [];
  if (!description) missing.push("description");
  if (!steps) missing.push("stepsToReproduce");
  if (!environment) missing.push("environment");

  if (missing.length > 0) {
    return {
      error:
        "missing required field(s): " +
        missing.join(", ") +
        ". Ask the customer for them before filing the ticket.",
    };
  }

  const ticketId = crypto.randomUUID();
  const report: BugReport = {
    ticketId,
    description,
    stepsToReproduce: steps,
    environment,
    status: "OPEN",
    createdAt: new Date().toISOString(),
  };

  bugReports.unshift(report);
  return { ticketId, status: "OPEN" };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/faq", (_req, res) => {
    try {
      const content = loadFaqContent();
      res.json({ content });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : "Failed to load FAQ",
      });
    }
  });

  app.get("/api/bug-reports", (_req, res) => {
    res.json({ reports: bugReports });
  });

  app.patch("/api/bug-reports/:ticketId", (req, res) => {
    const { ticketId } = req.params;
    const { status } = req.body as { status?: string };
    if (status !== "OPEN" && status !== "RESOLVED") {
      return res.status(400).json({ error: "Invalid status value." });
    }
    const report = bugReports.find((r) => r.ticketId === ticketId);
    if (!report) {
      return res.status(404).json({ error: "Bug report not found." });
    }
    report.status = status;
    return res.json({ report });
  });

  app.post("/api/sessions/reset", (req, res) => {
    const { sessionId } = req.body as { sessionId?: string };
    if (sessionId) {
      sessions.delete(sessionId);
    }
    const newSessionId = `${crypto.randomUUID()}-support-chat`;
    res.json({ sessionId: newSessionId });
  });

  app.post("/api/chat", async (req, res) => {
    try {
      const body = req.body as { sessionId?: string; message?: string };
      const userMessage = String(body.message ?? "").trim();
      if (!userMessage) {
        return res.status(400).json({ error: "Message cannot be empty." });
      }

      const sessionId =
        body.sessionId && body.sessionId.trim()
          ? body.sessionId.trim()
          : `${crypto.randomUUID()}-support-chat`;

      const ai = getAiClient();
      const systemInstruction = loadSystemPrompt();

      const existingHistory = sessions.get(sessionId) ?? [];
      const workingHistory: Content[] = [
        ...existingHistory,
        { role: "user", parts: [{ text: userMessage }] },
      ];

      const toolCalls: ToolCallRecord[] = [];
      let replyText = "";
      const maxRounds = 5;

      for (let round = 0; round < maxRounds; round++) {
        const response = await ai.models.generateContent({
          model: MODEL_ID,
          contents: workingHistory,
          config: {
            systemInstruction,
            tools: [{ functionDeclarations: [createBugReportDeclaration] }],
          },
        });

        const modelContent = response.candidates?.[0]?.content;
        const functionCalls = response.functionCalls;

        if (functionCalls && functionCalls.length > 0 && modelContent) {
          workingHistory.push(modelContent);

          const responseParts: Part[] = [];
          for (const fc of functionCalls) {
            const fcName = fc.name ?? "";
            const fcArgs = (fc.args ?? {}) as Record<string, unknown>;
            let result: Record<string, unknown>;

            if (fcName === "create_bug_report") {
              result = executeCreateBugReport(fcArgs);
            } else {
              result = { error: `unsupported tool: ${fcName}` };
            }

            toolCalls.push({
              name: `bugreports___${fcName}`,
              args: fcArgs,
              result,
            });

            responseParts.push({
              functionResponse: {
                id: fc.id,
                name: fcName,
                response: result,
              },
            });
          }

          workingHistory.push({
            role: "user",
            parts: responseParts,
          });
          continue;
        }

        replyText = (response.text ?? "").trim();
        if (modelContent) {
          workingHistory.push(modelContent);
        } else if (replyText) {
          workingHistory.push({
            role: "model",
            parts: [{ text: replyText }],
          });
        }
        break;
      }

      sessions.set(sessionId, workingHistory);

      return res.json({
        sessionId,
        reply: replyText,
        toolCalls,
      });
    } catch (err: unknown) {
      console.error("[/api/chat] error:", err);
      const message =
        err instanceof Error ? err.message : "Failed to generate reply.";
      return res.status(500).json({ error: message });
    }
  });

  if (process.env.NODE_ENV === "production") {
    const distDir = path.join(process.cwd(), "dist");
    app.use(express.static(distDir));
    app.get("/{*path}", (_req, res) => {
      res.sendFile(path.join(distDir, "index.html"));
    });
  } else {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Support chatbot server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
