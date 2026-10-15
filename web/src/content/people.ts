// Fictional name pools and flavor text. No real people.

export const FIRST_NAMES = [
  "Priya", "Tom", "Dana", "Mei", "Alex", "Sam", "Robin", "Noor", "Ari", "Leah",
  "Omar", "Sasha", "Eli", "Zoe", "Iris", "Max", "Kofi", "Lena", "Ravi", "Tess",
  "Jonah", "Amara", "Felix", "Hana", "Diego", "Ines", "Marek", "Yuki", "Bea", "Theo",
];

export const LAST_NAMES = [
  "Nair", "Ellis", "Okafor", "Chen", "Rivera", "Patel", "Hale", "Aziz", "Brooks", "Quinn",
  "Reed", "Kim", "Moss", "Bell", "Cole", "Lane", "Mensah", "Novak", "Iyer", "Hart",
  "Silva", "Duarte", "Weber", "Sato", "Lindqvist", "Adeyemi", "Kowal", "Haddad", "Ortiz", "Byrne",
];

export const BIOS = [
  "Knows where the bodies are buried in the build pipeline.",
  "Writes the runbook before anyone knows they need it.",
  "Still says yes to every meeting invitation.",
  "Turns an incident into a very short postmortem.",
  "Can explain the architecture without a diagram.",
  "The person quietly keeping the migration alive.",
  "Already fixing the onboarding guide.",
  "Asks the question everyone hoped to avoid.",
  "Has opinions about tabs. Strong ones.",
  "Reviews PRs at 7am, somehow kindly.",
  "Owns the flaky test nobody else will touch.",
  "Ships first, writes the RFC second, apologises third.",
  "Remembers every outage by its date.",
  "Treats the backlog like a garden.",
];

export const STAKEHOLDER_POOL: Record<"skip" | "pm" | "peer", { name: string; quote: string }[]> = {
  skip: [
    { name: "Morgan Vale", quote: "Show me the impact." },
    { name: "Avery Stone", quote: "What's the one-pager say?" },
    { name: "Jordan Pike", quote: "Let's not boil the ocean." },
  ],
  pm: [
    { name: "Jules Park", quote: "Can we squeeze this in?" },
    { name: "Remy Shaw", quote: "Customers are asking for it." },
    { name: "Kit Moreau", quote: "It's basically the same feature." },
  ],
  peer: [
    { name: "Casey Lin", quote: "Happy to take the credit." },
    { name: "Drew Calder", quote: "We should sync on headcount." },
    { name: "Parker Gray", quote: "My team could own that." },
  ],
};

export const FAREWELLS = [
  "I hope the next promo packet has a date on it.",
  "I left the runbook in the usual place.",
  "Thanks for noticing the pager.",
  "Take a week off before you start.",
  "We'll keep the demo alive.",
  "Don't say 'quick sync' on your first day.",
  "Good luck with the next roadmap.",
  "Someone has to ask the hard questions.",
];

export const TRAIT_LABEL: Record<string, string> = {
  "flight-risk": "Flight risk",
  "hero-coder": "Hero coder",
  "quiet-genius": "Quiet genius",
  "drama-magnet": "Drama magnet",
  "wants-to-lead": "Wants to lead",
  steady: "Steady hand",
};
