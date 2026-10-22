import type { CompanyId, Level } from "@/engine/types";

export interface CompanyDef {
  id: CompanyId;
  badge: string;
  tier: string;
  tagline: string;
  mechanic: string;
  promptBlurb: string;
  /** Engine modifiers */
  incidentBase: number;
  politics: number; // multiplier on politics-event weight
  projectNames: string[];
  salary: Record<Exclude<Level, "Director">, number>;
}

export const COMPANIES: Record<CompanyId, CompanyDef> = {
  Vercel: {
    id: "Vercel",
    badge: "VE",
    tier: "Startup",
    tagline: "Launches before breathing",
    mechanic: "A fixed keynote date each quarter. The flagship ships on stage.",
    promptBlurb:
      "A fast-moving developer-tools startup. Launch-driven, conference deadlines, priorities that swing with social media.",
    incidentBase: 0.22,
    politics: 0.8,
    projectNames: ["Checkout v2", "Edge config", "Preview comments", "Build cache", "Usage dashboard", "Image optimizer", "Log drains", "Spend alerts", "Domain transfers", "Cron jobs", "Firewall rules", "Team SSO"],
    salary: { EM: 195000, "Senior EM": 240000 },
  },
  Stripe: {
    id: "Stripe",
    badge: "ST",
    tier: "Scale-up",
    tagline: "Please write the doc",
    mechanic: "Incidents cost double Trust. A postmortem next week halves it.",
    promptBlurb:
      "A payments scale-up with a strong writing culture. High bar, long docs, reliability treated as sacred.",
    incidentBase: 0.26,
    politics: 1,
    projectNames: ["API migration", "Ledger rewrite", "Payouts v3", "Risk rules", "Dashboard search", "Webhook retries", "Tax reports", "Card issuing", "Dispute flow", "Idempotency keys", "Payout schedules", "Fraud signals"],
    salary: { EM: 205000, "Senior EM": 255000 },
  },
  Google: {
    id: "Google",
    badge: "GO",
    tier: "Big tech",
    tagline: "Align on the alignment",
    mechanic: "Promotions need a packet of evidence and a calibration verdict.",
    promptBlurb:
      "A very large tech company. Process-heavy, promo-driven, design-doc reviews, consensus across many teams.",
    incidentBase: 0.2,
    politics: 1.3,
    projectNames: ["Build reliability", "Quota service", "Launch checklist", "Search infra", "Cross-team platform", "Monorepo migration", "Latency budget", "Privacy review tool", "Config rollout", "Shared design system", "Capacity planner", "Experiment framework"],
    salary: { EM: 215000, "Senior EM": 270000 },
  },
};

export const COMPANY_IDS: CompanyId[] = ["Vercel", "Stripe", "Google"];

export const KEYNOTE_WEEK = 8;
export const PACKET_TARGET = 10;
