import { validateGrantCreate } from "./grants.js";
import { validateSensoriumSubscriptionRequest } from "./sensoriumSubscriptionRequest.js";

const SENSORIUM_CAPABILITY_PREFIX = "perception.sensorium.";
const SESSION_SCOPE = "session";

export function buildSensoriumGrantCreateCandidateFromProposal(
  proposal = {},
  {
    catalog = {},
    providerRegistry = {},
    now,
    createId,
  } = {},
) {
  const errors = [];

  if (proposal.status !== "approved" || proposal.decision?.decision !== "approved") {
    errors.push("proposal must be approved before a Sensorium grant candidate can be built");
  }
  if (proposal.decision?.decided_by !== "user") {
    errors.push("proposal approval must be decided by the user");
  }

  const approvalProvenanceId = stringValue(proposal.decision?.provenance_id);
  if (!approvalProvenanceId) {
    errors.push("approved proposal must include approval provenance before grant candidate creation");
  }

  const capability = stringValue(proposal.capability);
  if (!capability.startsWith(SENSORIUM_CAPABILITY_PREFIX) || !capability.endsWith(".subscribe")) {
    errors.push("proposal capability must be a Sensorium subscription capability");
  }

  const review = plainObjectOrNull(proposal.review_context);
  const intent = plainObjectOrNull(proposal.grant_intent);
  if (!review) {
    errors.push("proposal must include Sensorium review_context");
  }
  if (!intent) {
    errors.push("proposal must include Sensorium grant_intent");
  }

  if (review && intent) {
    validateReviewAndIntent({
      proposal,
      review,
      intent,
      errors,
    });
  }

  if (errors.length > 0) {
    throwSensoriumGrantCandidateError(errors);
  }

  const constraints = {
    ...intent.constraints,
    topic: review.topic,
  };
  const candidate = {
    capability,
    provider: intent.provider,
    scope: SESSION_SCOPE,
    constraints,
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
      subscription_activated: false,
    };
  } catch (error) {
    if (error?.code) {
      throwSensoriumGrantCandidateError([error.message], error.code);
    }
    throw error;
  }
}

function validateReviewAndIntent({ proposal, review, intent, errors }) {
  if (intent.capability !== proposal.capability || review.capability !== proposal.capability) {
    errors.push("review_context and grant_intent must match proposal capability");
  }
  if (intent.provider !== review.provider) {
    errors.push("review_context and grant_intent must match provider");
  }
  if (intent.scope !== SESSION_SCOPE || review.scope !== SESSION_SCOPE) {
    errors.push("Sensorium grant candidates currently require session scope");
  }
  if (proposal.requested_scope !== SESSION_SCOPE) {
    errors.push("approved proposal must have requested_scope=session");
  }
  if (!plainObjectOrNull(intent.constraints)) {
    errors.push("grant_intent.constraints must be an object");
    return;
  }
  if (typeof review.topic !== "string" || review.topic.length === 0) {
    errors.push("review_context.topic is required");
    return;
  }
  if (review.revocation?.immediate_stop !== true) {
    errors.push("review_context.revocation.immediate_stop must be true");
  }

  try {
    validateSensoriumSubscriptionRequest(
      {
        topic: review.topic,
        constraints: intent.constraints,
      },
      { capability: proposal.capability },
    );
  } catch (error) {
    errors.push(...(error.validation_errors ?? [error.message]));
  }
}

function plainObjectOrNull(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value;
}

function stringValue(value) {
  return String(value ?? "").trim();
}

function throwSensoriumGrantCandidateError(errors, code = "invalid_sensorium_grant_candidate") {
  const error = new Error(`Invalid Sensorium grant candidate: ${errors.join("; ")}`);
  error.statusCode = 400;
  error.code = code;
  error.validation_errors = errors;
  throw error;
}
