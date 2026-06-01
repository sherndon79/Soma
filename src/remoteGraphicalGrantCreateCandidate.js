import { validateGrantCreate } from "./grants.js";

const REMOTE_GRAPHICAL_DEFINITIONS = {
  "perception.remote_desktop.video.subscribe": {
    authority: "video",
    mode: "view_only",
    required_channels: ["video"],
    video: true,
  },
  "desktop.remote.input.pointer": {
    authority: "pointer",
    mode: "pointer_input",
    required_channels: ["pointer"],
    video: false,
  },
  "desktop.remote.input.keyboard": {
    authority: "keyboard",
    mode: "keyboard_input",
    required_channels: ["keyboard"],
    video: false,
  },
  "desktop.remote.session.disconnect": {
    authority: "disconnect",
    mode: "disconnect",
    required_channels: ["disconnect"],
    video: false,
  },
};

export function buildRemoteGraphicalGrantCreateCandidateFromProposal(
  proposal = {},
  {
    catalog = {},
    providerRegistry = {},
    now,
    createId,
  } = {},
) {
  const errors = [];

  if (proposal.type === "capability_design") {
    throwRemoteGraphicalGrantCandidateError(
      ["capability design proposals are review-only and cannot create remote graphical grant candidates"],
      "remote_graphical_grant_candidate_rejects_capability_design",
    );
  }

  if (proposal.status !== "approved" || proposal.decision?.decision !== "approved") {
    errors.push("proposal must be approved before a remote graphical grant candidate can be built");
  }
  if (proposal.decision?.decided_by !== "user") {
    errors.push("proposal approval must be decided by the user");
  }

  const approvalProvenanceId = stringValue(proposal.decision?.provenance_id);
  if (!approvalProvenanceId) {
    errors.push("approved proposal must include approval provenance before grant candidate creation");
  }

  const capability = stringValue(proposal.capability);
  const definition = REMOTE_GRAPHICAL_DEFINITIONS[capability];
  if (!definition) {
    errors.push("proposal capability must be a remote graphical capability");
  }

  const review = plainObjectOrNull(proposal.review_context);
  const intent = plainObjectOrNull(proposal.grant_intent);
  if (!review) {
    errors.push("proposal must include remote graphical review_context");
  }
  if (!intent) {
    errors.push("proposal must include remote graphical grant_intent");
  }

  if (definition && review && intent) {
    validateReviewAndIntent({
      proposal,
      review,
      intent,
      definition,
      errors,
    });
  }

  if (errors.length > 0) {
    throwRemoteGraphicalGrantCandidateError(errors);
  }

  const candidate = {
    capability,
    provider: intent.provider,
    scope: intent.scope,
    constraints: { ...intent.constraints },
    approved_by: "user",
    approval_provenance_id: approvalProvenanceId,
    reason: proposal.reason,
    created_at: now?.(),
    id: createId?.(),
    review_required: false,
    direct_user_action: false,
  };

  try {
    return {
      grant_create_input: validateGrantCreate(candidate, {
        catalog,
        providerRegistry,
        now,
        createId,
      }),
      source_proposal_id: proposal.id ?? "",
      activation_performed: false,
      grant_written: false,
      session_opened: false,
      pairing_performed: false,
      video_attached: false,
      input_dispatched: false,
      recording_started: false,
    };
  } catch (error) {
    if (error?.code) {
      throwRemoteGraphicalGrantCandidateError([error.message], error.code);
    }
    throw error;
  }
}

function validateReviewAndIntent({ proposal, review, intent, definition, errors }) {
  if (intent.capability !== proposal.capability || review.capability !== proposal.capability) {
    errors.push("review_context and grant_intent must match proposal capability");
  }
  if (intent.provider !== review.provider) {
    errors.push("review_context and grant_intent must match provider");
  }
  if (intent.scope !== proposal.requested_scope || review.scope !== proposal.requested_scope) {
    errors.push("review_context and grant_intent must match proposal requested_scope");
  }
  if (proposal.decision?.approved_scope !== proposal.requested_scope) {
    errors.push("proposal approved_scope must match requested_scope");
  }
  if (intent.reason !== proposal.reason) {
    errors.push("grant_intent.reason must match proposal reason");
  }
  if (review.revocation?.immediate_stop !== true) {
    errors.push("review_context.revocation.immediate_stop must be true");
  }
  if (!plainObjectOrNull(intent.constraints)) {
    errors.push("grant_intent.constraints must be an object");
    return;
  }
  if (!isHostLike(review.target_host)) {
    errors.push("review_context.target_host must be a hostname-like identifier");
  }
  if (intent.constraints.target_host !== review.target_host) {
    errors.push("review_context and grant_intent must match target_host");
  }
  if (review.mode !== definition.mode || intent.constraints.mode !== definition.mode) {
    errors.push(`review_context and grant_intent mode must be ${definition.mode}`);
  }
  if (review.authority !== definition.authority) {
    errors.push(`review_context.authority must be ${definition.authority}`);
  }
  if (!sameStringSet(review.requested_channels, intent.constraints.requested_channels)) {
    errors.push("review_context and grant_intent must match requested_channels");
  }
  for (const required of definition.required_channels) {
    if (!normalizeStringList(intent.constraints.requested_channels).includes(required)) {
      errors.push(`grant_intent.constraints.requested_channels must include ${required}`);
    }
  }
  if (!Number.isInteger(intent.constraints.max_seconds) || intent.constraints.max_seconds < 1) {
    errors.push("grant_intent.constraints.max_seconds must be a positive integer");
  }
  if (definition.video) {
    for (const key of ["max_fps", "max_width", "max_height"]) {
      if (!Number.isInteger(intent.constraints[key]) || intent.constraints[key] < 1) {
        errors.push(`grant_intent.constraints.${key} must be a positive integer`);
      }
    }
  } else {
    for (const key of ["max_fps", "max_width", "max_height"]) {
      if (Object.hasOwn(intent.constraints, key)) {
        errors.push(`grant_intent.constraints.${key} is only valid for video authority`);
      }
    }
  }
}

function plainObjectOrNull(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value;
}

function normalizeStringList(value) {
  return Array.isArray(value) ? value.map((entry) => stringValue(entry)).filter(Boolean) : [];
}

function sameStringSet(left, right) {
  const a = normalizeStringList(left).sort();
  const b = normalizeStringList(right).sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function isHostLike(value) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,252}$/.test(String(value ?? ""));
}

function stringValue(value) {
  return String(value ?? "").trim();
}

function throwRemoteGraphicalGrantCandidateError(errors, code = "invalid_remote_graphical_grant_candidate") {
  const error = new Error(`Invalid remote graphical grant candidate: ${errors.join("; ")}`);
  error.statusCode = 400;
  error.code = code;
  error.validation_errors = errors;
  throw error;
}
