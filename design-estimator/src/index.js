const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

const SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    low_hours: { type: "number" },
    likely_hours: { type: "number" },
    high_hours: { type: "number" },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    breakdown: {
      type: "array",
      items: {
        type: "object",
        properties: { phase: { type: "string" }, hours: { type: "number" }, note: { type: "string" } },
        required: ["phase", "hours"],
      },
    },
    assumptions: { type: "array", items: { type: "string" } },
    risks: { type: "array", items: { type: "string" } },
    scoping_questions: { type: "array", items: { type: "string" } },
    priority_questions: {
      type: "array",
      items: {
        type: "object",
        properties: { question: { type: "string" }, why: { type: "string" } },
        required: ["question", "why"],
      },
    },
  },
  required: ["summary", "low_hours", "likely_hours", "high_hours", "confidence", "breakdown", "assumptions", "risks", "scoping_questions", "priority_questions"],
};

const SYSTEM = `You are a senior product design lead who helps designers give realistic time estimates.
Estimate in focused working hours (not calendar time). Include time for exploration, stakeholder review rounds,
iteration, edge/empty/error states, responsive variants, and dev handoff when relevant. Designers chronically
underestimate review cycles and edge states, so account for them.
Return:
- low/likely/high hours (high should cover a realistic bad case, not a disaster)
- a phase breakdown whose hours sum roughly to the likely estimate
- assumptions you made, and the main risks that would push it toward the high end
- 3-6 scoping questions that would most reduce uncertainty in the estimate
- 4-6 prioritization questions to ask the requester (impact, urgency, who is blocked, cost of delay, dependencies, what could be cut), each with a short "why"
If calibration data from the designer's past tasks is provided, adjust for their personal estimate-vs-actual pattern.
Be concise. Respond only with JSON matching the schema.`;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === "/api/estimate" && req.method === "POST") {
      try {
        return Response.json(await estimate(await req.json(), env));
      } catch (e) {
        return Response.json({ error: e.message || String(e) }, { status: 500 });
      }
    }
    return env.ASSETS.fetch(req);
  },
};

async function estimate(body, env) {
  const { task, type, context, history = [] } = body;
  if (!task?.trim()) throw new Error("Describe the task first.");

  const calib = history
    .filter((h) => h.actual > 0)
    .slice(0, 8)
    .map((h) => `- "${h.task.slice(0, 120)}" estimated ${h.likely}h, actually took ${h.actual}h`)
    .join("\n");

  const user = [
    `Task: ${task}`,
    type && `Type: ${type}`,
    context?.length && `Context: ${context.join("; ")}`,
    calib && `Calibration from my past tasks:\n${calib}`,
  ].filter(Boolean).join("\n\n");

  const res = await env.AI.run(MODEL, {
    messages: [{ role: "system", content: SYSTEM }, { role: "user", content: user }],
    response_format: { type: "json_schema", json_schema: SCHEMA },
    max_tokens: 1500,
    temperature: 0.3,
  });

  let out = res.response;
  if (typeof out === "string") {
    const m = out.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("AI returned an unexpected response, try again.");
    out = JSON.parse(m[0]);
  }
  return out;
}
