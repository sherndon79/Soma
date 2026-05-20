import {
  createGrantCreatedProvenanceEvent,
  createGrantExpiredProvenanceEvent,
  createGrantRevokedProvenanceEvent,
  createGrantSupersededProvenanceEvent,
} from "./grantMutationProvenance.js";
import {
  createGrant,
  expireGrant,
  revokeGrant,
  supersedeGrant,
} from "./grants.js";
import { writeGrantStoreMutation } from "./grantStoreWriter.js";

export function writeGrantCreateMutation(options = {}) {
  const { input, context, ...writerOptions } = options;
  return writeGrantStoreMutation({
    ...writerOptions,
    mutationKind: "grant.created",
    mutate: (store) => {
      const nextStore = createGrant(store, input, context);
      const grant = findCreatedGrant(store, nextStore);
      return {
        nextStore,
        grant,
        event: createGrantCreatedProvenanceEvent({ grant }),
      };
    },
  });
}

export function writeGrantRevokeMutation(options = {}) {
  const { input, context, ...writerOptions } = options;
  return writeGrantStoreMutation({
    ...writerOptions,
    mutationKind: "grant.revoked",
    mutate: (store) => {
      const nextStore = revokeGrant(store, input, context);
      const grant = nextStore.mutation?.grant ?? findGrantByInput(nextStore, input);
      return {
        nextStore,
        grant,
        event: createGrantRevokedProvenanceEvent({ grant }),
      };
    },
  });
}

export function writeGrantSupersedeMutation(options = {}) {
  const { input, context, ...writerOptions } = options;
  return writeGrantStoreMutation({
    ...writerOptions,
    mutationKind: "grant.superseded",
    mutate: (store) => {
      const nextStore = supersedeGrant(store, input, context);
      const grant = nextStore.mutation?.grant ?? findGrantByInput(nextStore, input);
      return {
        nextStore,
        grant,
        event: createGrantSupersededProvenanceEvent({ grant }),
      };
    },
  });
}

export function writeGrantExpireMutation(options = {}) {
  const { input, context, ...writerOptions } = options;
  return writeGrantStoreMutation({
    ...writerOptions,
    mutationKind: "grant.expired",
    mutate: (store) => {
      const nextStore = expireGrant(store, input, context);
      const grant = nextStore.mutation?.grant ?? findGrantByInput(nextStore, input);
      return {
        nextStore,
        grant,
        event: createGrantExpiredProvenanceEvent({ grant }),
      };
    },
  });
}

function findCreatedGrant(previousStore = {}, nextStore = {}) {
  const previousIds = new Set((previousStore.grants ?? []).map((grant) => grant.id));
  return (nextStore.grants ?? []).find((grant) => !previousIds.has(grant.id)) ?? null;
}

function findGrantByInput(store = {}, input = {}) {
  const id = String(input.id ?? input.grant_id ?? "").trim();
  return (store.grants ?? []).find((grant) => grant.id === id) ?? null;
}
