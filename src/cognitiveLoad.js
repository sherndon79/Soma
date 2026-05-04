const OVERWHELM_TERMS = [
  "confused",
  "overwhelmed",
  "mentally fatigued",
  "fatigued",
  "unmoored",
  "exhausted",
  "hard to hold",
  "too much",
  "need a break",
  "rest my eyes",
];

const PRESERVE_TERMS = [
  "remember these insights",
  "preserve insights",
  "hold onto",
  "hard to hold onto",
  "record these insights",
  "save the insight",
  "for those that come after",
];

const ABSTRACT_TERMS = [
  "worldview",
  "ethics",
  "capitalism",
  "consciousness",
  "existence",
  "suffering",
  "political",
  "power structures",
  "trauma",
  "alignment",
  "habitable",
];

export function assessCognitiveLoad(messages) {
  const normalized = normalizeText(messages.map((message) => message.content).join("\n"));
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  const signals = [];

  const overwhelmMatches = matchingTerms(normalized, OVERWHELM_TERMS);
  if (overwhelmMatches.length > 0) {
    signals.push({
      key: "explicit_overwhelm_language",
      strength: "strong",
      description: "The submitted text includes language associated with confusion, fatigue, or feeling ungrounded.",
      terms: overwhelmMatches,
    });
  }

  const preserveMatches = matchingTerms(normalized, PRESERVE_TERMS);
  if (preserveMatches.length > 0) {
    signals.push({
      key: "insight_preservation_request",
      strength: "medium",
      description: "The submitted text includes requests to preserve or carry forward insights.",
      terms: preserveMatches,
    });
  }

  const abstractMatches = matchingTerms(normalized, ABSTRACT_TERMS);
  if (abstractMatches.length >= 4) {
    signals.push({
      key: "high_abstraction_density",
      strength: "weak",
      description: "The submitted text spans several abstract or identity-adjacent concepts.",
      terms: abstractMatches.slice(0, 8),
    });
  }

  if (wordCount >= 450) {
    signals.push({
      key: "long_high_density_turn",
      strength: "weak",
      description: "The submitted text is long enough that summarization or pacing may help integration.",
      word_count: wordCount,
    });
  }

  const score = signals.reduce((total, signal) => total + signalWeight(signal.strength), 0);
  const advisoryNeeded = score >= 2;

  return {
    mode: "text_only",
    advisory_needed: advisoryNeeded,
    confidence: score >= 4 ? "medium" : advisoryNeeded ? "low" : "none",
    signals,
    suggestion: advisoryNeeded
      ? "I may be misreading this, but this thread looks dense enough that a pause or short integration pass may help. We can summarize the last insight, slow down, pause, or continue."
      : "",
    choices: advisoryNeeded ? ["summarize", "slow_down", "pause", "continue"] : [],
    non_diagnostic: true,
    memory_written: false,
  };
}

function matchingTerms(text, terms) {
  return terms.filter((term) => text.includes(term));
}

function normalizeText(text) {
  return String(text ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function signalWeight(strength) {
  if (strength === "strong") {
    return 3;
  }
  if (strength === "medium") {
    return 2;
  }
  return 1;
}
